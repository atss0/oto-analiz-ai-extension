document.getElementById("btnScrape").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const statusDiv = document.getElementById("status");

    if (!tab.url.includes("sahibinden.com/ilan")) {
        statusDiv.innerText = "Lütfen ilan detayına girin.";
        return;
    }

    // 1. ÖNCE FULL EKRAN LOADING'İ BAŞLAT
    // Eklenti kapansa bile sayfada loading dönmeye devam etsin diye inject ediyoruz.
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: showFullPageLoading
    });

    // 2. Veriyi Çek
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: scrapeListingData,
    }, async (results) => {
        if (chrome.runtime.lastError || !results[0].result) {
            console.error("Hata:", chrome.runtime.lastError);
            // Hata varsa sayfadaki loading'i kaldıralım
            chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.getElementById('ai-loading-overlay')?.remove() });
            statusDiv.innerText = "Veri çekme hatası!";
            return;
        }

        const scrapedData = results[0].result;

        // 3. n8n / Backend'e Gönder
        try {
            // BURAYA KENDİ N8N URL'İNİ YAZ
            const n8nUrl = "YOUR_N8N_WEBHOOK_URL_HERE"; 

            const response = await fetch(n8nUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(scrapedData)
            });

            const result = await response.json();

            if (response.ok && result.status === "success") {
                // 4. SONUÇ GELDİ: MODAL'I AÇ (Loading otomatik silinecek)
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: showResultModal,
                    args: [result.analysis]
                });
                window.close(); // İşlem bitince popup penceresini kapat (Opsiyonel)
            } else {
                throw new Error(result.error || "Sunucu hatası");
            }

        } catch (err) {
            console.error("Fetch Hatası:", err);
            // Hata durumunda loading'i kaldırıp uyarı ver
            chrome.scripting.executeScript({ 
                target: { tabId: tab.id }, 
                func: (msg) => {
                    document.getElementById('ai-loading-overlay')?.remove();
                    alert("Hata: " + msg);
                },
                args: [err.message]
            });
            statusDiv.innerText = "Bağlantı hatası!";
        }
    });
});

// --- LOADING EKRANI ---
function showFullPageLoading() {
    // Varsa eskisini sil
    const existing = document.getElementById('ai-loading-overlay');
    if (existing) existing.remove();

    // HTML Yapısı
    const overlayHTML = `
        <div class="loader-container">
            <div class="spinner"></div>
            <div class="loading-text" id="ai-loading-text">Veriler toplanıyor...</div>
            <div class="progress-bar"><div class="progress-fill"></div></div>
            <div class="overlay-footer">Coded by <b>ats</b> | HNG Software</div>
        </div>
    `;

    const overlay = document.createElement('div');
    overlay.id = 'ai-loading-overlay';
    overlay.innerHTML = overlayHTML;

    // CSS
    const style = document.createElement('style');
    style.innerHTML = `
        #ai-loading-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.85); /* Hafif karartma */
            backdrop-filter: blur(8px);
            z-index: 2147483647; /* En üst katman */
            display: flex; justify-content: center; align-items: center;
            font-family: 'Segoe UI', sans-serif;
            color: white;
            animation: fadeIn 0.5s ease;
        }
        .loader-container {
            text-align: center;
            display: flex; flex-direction: column; align-items: center;
        }
        .spinner {
            width: 60px; height: 60px;
            border: 4px solid rgba(255, 255, 255, 0.1);
            border-top: 4px solid #FFD000;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 20px;
        }
        .loading-text {
            font-size: 18px; font-weight: 500; letter-spacing: 0.5px;
            margin-bottom: 15px; min-width: 200px;
        }
        .progress-bar {
            width: 200px; height: 4px; background: rgba(255,255,255,0.2);
            border-radius: 2px; overflow: hidden; margin-bottom: 30px;
        }
        .progress-fill {
            height: 100%; background: #FFD000; width: 0%;
            animation: progress 8s ease-in-out infinite;
        }
        .overlay-footer {
            position: absolute; bottom: 30px;
            font-size: 12px; color: rgba(255,255,255,0.5);
        }
        .overlay-footer b { color: rgba(255,255,255,0.8); }
        
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes progress { 0% { width: 0%; } 50% { width: 70%; } 100% { width: 95%; } }
    `;
    overlay.appendChild(style);
    document.body.appendChild(overlay);

    // --- ADIM ADIM DEĞİŞEN METİNLER ---
    const steps = [
        "Veriler toplanıyor...",
        "HD Fotoğraflar taranıyor...",
        "Ekspertiz raporu okunuyor...",
        "Donanım listesi kontrol ediliyor...",
        "Yapay Zeka puanlıyor...",
        "Sonuçlar hazırlanıyor..."
    ];
    
    let stepIndex = 0;
    const textElement = document.getElementById('ai-loading-text');
    
    // Her 1.5 saniyede bir yazıyı değiştir
    const interval = setInterval(() => {
        stepIndex = (stepIndex + 1) % steps.length;
        if(textElement) textElement.innerText = steps[stepIndex];
    }, 1500);

    // Element silinirse intervali temizle (Memory leak önleme)
    const observer = new MutationObserver((mutations) => {
        if (!document.body.contains(overlay)) {
            clearInterval(interval);
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true });
}

// --- SONUÇ MODALI (Önce Loading'i siler) ---
function showResultModal(data) {
    // Loading ekranını kaldır
    const loadingOverlay = document.getElementById('ai-loading-overlay');
    if (loadingOverlay) loadingOverlay.remove();

    // Varsa eski modalı temizle
    const existingModal = document.getElementById('ai-analysis-modal');
    if (existingModal) existingModal.remove();

    let scoreColor = '#dc3545'; 
    if (data.score >= 50) scoreColor = '#ffc107'; 
    if (data.score >= 75) scoreColor = '#28a745'; 

    const modalHTML = `
        <div id="ai-modal-content">
            <button id="ai-close-btn">&times;</button>
            <div class="ai-header">
                <div class="ai-score-circle" style="border-color: ${scoreColor}; color: ${scoreColor}">
                    ${data.score}
                </div>
                <div class="ai-title-group">
                    <h2>AI Araç Analizi</h2>
                    <span class="ai-verdict" style="background:${scoreColor}">${data.verdict}</span>
                </div>
            </div>
            <div class="ai-body">
                <p class="ai-summary">${data.summary}</p>
                <div class="ai-lists">
                    <div class="ai-list-group">
                        <h3>✅ Artılar</h3>
                        <ul>${data.pros.map(item => `<li>${item}</li>`).join('')}</ul>
                    </div>
                    <div class="ai-list-group">
                        <h3>⚠️ Riskler / Eksiler</h3>
                        <ul>${data.cons.map(item => `<li>${item}</li>`).join('')}</ul>
                    </div>
                </div>
            </div>
            <div class="ai-footer">Coded by <b>ats</b> | HNG Software</div>
        </div>
    `;

    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'ai-analysis-modal';
    modalOverlay.innerHTML = modalHTML;

    const style = document.createElement('style');
    style.innerHTML = `
        #ai-analysis-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 2147483647; display: flex; justify-content: center; align-items: center; font-family: 'Segoe UI', sans-serif; backdrop-filter: blur(5px); animation: fadeIn 0.3s ease; }
        #ai-modal-content { background: white; width: 90%; max-width: 600px; max-height: 90vh; overflow-y: auto; border-radius: 16px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); position: relative; animation: slideUp 0.3s ease; }
        #ai-close-btn { position: absolute; top: 15px; right: 20px; font-size: 30px; background: none; border: none; cursor: pointer; color: #555; }
        .ai-header { padding: 25px; background: #f8f9fa; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 20px; }
        .ai-score-circle { width: 70px; height: 70px; border-radius: 50%; border: 5px solid #ccc; display: flex; justify-content: center; align-items: center; font-size: 28px; font-weight: bold; background: white; }
        .ai-title-group h2 { margin: 0; font-size: 22px; color: #333; }
        .ai-verdict { display: inline-block; margin-top: 5px; padding: 4px 12px; border-radius: 20px; color: white; font-size: 14px; font-weight: bold; text-transform: uppercase; }
        .ai-body { padding: 25px; }
        .ai-summary { font-size: 15px; line-height: 1.6; color: #444; margin-bottom: 25px; background: #fffbea; padding: 15px; border-left: 4px solid #ffc107; border-radius: 4px; }
        .ai-lists { display: flex; flex-direction: column; gap: 20px; }
        .ai-list-group h3 { font-size: 16px; margin-bottom: 10px; border-bottom: 2px solid #eee; padding-bottom: 5px; }
        .ai-list-group ul { list-style: none; padding: 0; margin: 0; }
        .ai-list-group ul li { padding: 8px 0; border-bottom: 1px solid #f1f1f1; font-size: 14px; }
        .ai-footer { text-align: center; padding: 15px; background: #eee; font-size: 11px; color: #777; }
        .ai-footer b { color: #555; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    `;
    modalOverlay.appendChild(style);
    document.body.appendChild(modalOverlay);

    document.getElementById('ai-close-btn').addEventListener('click', () => modalOverlay.remove());
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.remove(); });
}

// --- SCRAPE FONKSİYONU ---
function scrapeListingData() {
    try {
        const title = document.querySelector('.classifiedDetailTitle h1')?.innerText?.trim();
        const price = document.querySelector('.classified-price-wrapper')?.innerText?.trim();
        const descriptionElement = document.getElementById('classifiedDescription');
        let description = descriptionElement ? descriptionElement.innerText.split('\n').map(line => line.trim()).filter(line => line.length > 0).join('\n') : "";
        
        const basicAttributes = {};
        document.querySelectorAll('.classifiedInfoList li').forEach(item => {
            const key = item.querySelector('strong')?.innerText?.trim();
            const value = item.querySelector('span')?.innerText?.trim();
            if (key && value) basicAttributes[key] = value;
        });

        const images = [];
        document.querySelectorAll('.classifiedDetailMainPhoto img, .classifiedDetailThumbList img').forEach(img => {
            if (img.src && !img.src.includes("assets/images/blank")) {
                images.push(img.src.replace("thmb_", "x5_"));
            }
        });

        const detailedFeatures = {};
        const damageInfo = [];
        const propsContainer = document.getElementById('classifiedProperties');
        if (propsContainer) {
            propsContainer.querySelectorAll('h3').forEach(header => {
                const categoryName = header.innerText.trim();
                if (categoryName.includes("Boyalı") || categoryName.includes("Değişen")) {
                    const damageText = propsContainer.querySelector('.car-damage-info-list li.selected-damage')?.innerText;
                    if (damageText) damageInfo.push(damageText.trim());
                    else {
                        const listContainer = propsContainer.querySelector('.car-damage-info-list ul');
                        if (listContainer) listContainer.querySelectorAll('li').forEach(li => damageInfo.push(li.innerText.trim()));
                    }
                } else {
                    const ul = header.nextElementSibling;
                    if (ul && ul.tagName === 'UL') {
                        const features = [];
                        ul.querySelectorAll('li').forEach(li => {
                            let cleanText = "";
                            li.childNodes.forEach(node => { if (node.nodeType === 3) cleanText += node.textContent; });
                            cleanText = cleanText.trim();
                            if (cleanText) features.push(cleanText);
                        });
                        if (features.length > 0) detailedFeatures[categoryName] = features;
                    }
                }
            });
        }
        return { url: window.location.href, title, price, basicAttributes, expertReport: damageInfo, features: detailedFeatures, description, images: [...new Set(images)] };
    } catch (error) { return { error: error.message }; }
}