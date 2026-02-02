// Popup'tan gelen Analizi Başlat dinle
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "start_analysis") {
    const tabId = request.tabId;
    const category = request.category;

    runAnalysisProcess(tabId, category);
  }
});

async function runAnalysisProcess(tabId, category) {
  try {
    // 1. LOADING EKRANINI GÖSTER
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: showFullPageLoading,
      args: [category]
    });

    // 2. VERİLERİ ÇEK
    const scrapeResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: scrapeListingData,
      args: [category]
    });

    if (!scrapeResult || !scrapeResult[0] || !scrapeResult[0].result) {
      throw new Error("Veri çekilemedi.");
    }

    const scrapedData = scrapeResult[0].result;

    // 3. N8N'E GÖNDER
    // BURAYA KENDİ N8N URL'İNİ YAZ
    const n8nUrl = "YOUR_N8N_WEBHOOK_URL_HERE"; 

    const response = await fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scrapedData)
    });

    const result = await response.json();

    if (response.ok && result.status === "success") {
        // 4. SONUÇ GELDİ: MODAL'I AÇ
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: showResultModal,
            args: [result.analysis]
        });
    } else {
        throw new Error(result.error || "Sunucu hatası");
    }

  } catch (err) {
    console.error("Background Hatası:", err);
    // Hata olursa kullanıcıya bildir ve loading'i kaldır
    chrome.scripting.executeScript({ 
        target: { tabId: tabId }, 
        func: (msg) => {
            document.getElementById('ai-loading-overlay')?.remove();
            alert("Bir sorun oluştu lütfen tekrar deneyiniz.");
        },
        args: [err.message]
    });
  }
}

// --- BURADAN AŞAĞISI "POPUP.JS"TEKİ FONKSİYONLARIN AYNISI ---
// (Background script'in bunları sayfaya enjekte edebilmesi için burada tanımlı olmaları lazım)

function showFullPageLoading(category) {
    const existing = document.getElementById('ai-loading-overlay');
    if (existing) existing.remove();

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

    const style = document.createElement('style');
    style.innerHTML = `
        #ai-loading-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(8px); z-index: 2147483647; display: flex; justify-content: center; align-items: center; font-family: 'Segoe UI', sans-serif; color: white; animation: fadeIn 0.5s ease; }
        .loader-container { text-align: center; display: flex; flex-direction: column; align-items: center; }
        .spinner { width: 60px; height: 60px; border: 4px solid rgba(255, 255, 255, 0.1); border-top: 4px solid #FFD000; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px; }
        .loading-text { font-size: 18px; font-weight: 500; letter-spacing: 0.5px; margin-bottom: 15px; min-width: 250px; transition: opacity 0.3s ease; }
        .progress-bar { width: 200px; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; overflow: hidden; margin-bottom: 30px; }
        .progress-fill { height: 100%; background: #FFD000; width: 0%; animation: progress 8s ease-in-out infinite; }
        .overlay-footer { position: absolute; bottom: 30px; font-size: 12px; color: rgba(255,255,255,0.5); }
        .overlay-footer b { color: rgba(255,255,255,0.8); }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes progress { 0% { width: 0%; } 50% { width: 70%; } 100% { width: 95%; } }
    `;
    overlay.appendChild(style);
    document.body.appendChild(overlay);

    let steps = [];
    if (category === "oto") {
        steps = ["Araç verileri toplanıyor...", "HD Fotoğraflar taranıyor...", "Ekspertiz raporu okunuyor...", "Hasar kaydı kontrolü...", "AI Puanlıyor...", "Sonuçlar hazırlanıyor..."];
    } else {
        steps = ["Emlak verileri toplanıyor...", "Oda ve m² analizi yapılıyor...", "Konum ve Cephe kontrolü...", "Fotoğraflardaki kusurlar aranıyor...", "Fiyat analizi yapılıyor...", "Rapor hazırlanıyor..."];
    }
    
    let stepIndex = 0;
    const textElement = document.getElementById('ai-loading-text');
    
    // İlk metni hemen ayarla
    if(textElement) textElement.innerText = steps[0];

    const interval = setInterval(() => {
        stepIndex++;
        
        // Eğer son adıma geldiysek
        if (stepIndex >= steps.length - 1) {
            // Son metni yaz
            if(textElement) textElement.innerText = steps[steps.length - 1];
            // İntervali temizle (Döngüyü durdur)
            clearInterval(interval);
        } else {
            // Devam ediyorsa sıradaki metni yaz
            if(textElement) textElement.innerText = steps[stepIndex];
        }
    }, 2000); // 2 saniyede bir değişsin (Biraz daha okunaklı olsun)

    // Temizlik (Overlay silinirse interval dursun)
    const observer = new MutationObserver(() => {
        if (!document.body.contains(overlay)) { clearInterval(interval); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true });
}

function showResultModal(data) {
    const loadingOverlay = document.getElementById('ai-loading-overlay');
    if (loadingOverlay) loadingOverlay.remove();
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
                    <h2>AI Analiz Raporu</h2>
                    <span class="ai-verdict" style="background:${scoreColor}">${data.verdict}</span>
                </div>
            </div>
            <div class="ai-body">
                <p class="ai-summary">${data.summary}</p>
                <div class="ai-lists">
                    <div class="ai-list-group">
                        <h3>✅ Avantajlar</h3>
                        <ul>${data.pros.map(item => `<li>${item}</li>`).join('')}</ul>
                    </div>
                    <div class="ai-list-group">
                        <h3>⚠️ Riskler / Dikkat</h3>
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

function scrapeListingData(category) {
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

        let expertReport = [];
        const detailedFeatures = {};

        // YENİ: İlan Tipi Tespiti (Satılık / Kiralık / Günlük)
        let listingType = "Bilinmiyor";
        if (category === "emlak") {
            // Breadcrumb'dan (Sayfa üstündeki yol haritası) anla
            const breadcrumbs = document.querySelectorAll('.search-result-bc .bc-item a');
            for (let bc of breadcrumbs) {
                const text = bc.innerText.trim().toLowerCase();
                if (text === "kiralık") { listingType = "Kiralık"; break; }
                if (text === "satılık") { listingType = "Satılık"; break; }
                if (text === "günlük kiralık") { listingType = "Günlük Kiralık"; break; }
                if (text === "devren") { listingType = "Devren"; break; }
            }
            // Bulamazsa özelliklerden dene
            if (listingType === "Bilinmiyor" && basicAttributes['Emlak Tipi']) {
                 if (basicAttributes['Emlak Tipi'].includes('Kiralık')) listingType = "Kiralık";
                 if (basicAttributes['Emlak Tipi'].includes('Satılık')) listingType = "Satılık";
            }
        }

        const propsContainer = document.getElementById('classifiedProperties');
        if (propsContainer) {
            if (category === "oto") {
                propsContainer.querySelectorAll('h3').forEach(header => {
                    const categoryName = header.innerText.trim();
                    if (categoryName.includes("Boyalı") || categoryName.includes("Değişen")) {
                        const damageText = propsContainer.querySelector('.car-damage-info-list li.selected-damage')?.innerText;
                        if (damageText) expertReport.push(damageText.trim());
                        else {
                            const listContainer = propsContainer.querySelector('.car-damage-info-list ul');
                            if (listContainer) listContainer.querySelectorAll('li').forEach(li => expertReport.push(li.innerText.trim()));
                        }
                    } else {
                        const ul = header.nextElementSibling;
                        if (ul && ul.tagName === 'UL') {
                            const features = [];
                            ul.querySelectorAll('li').forEach(li => features.push(li.innerText.trim()));
                            if (features.length > 0) detailedFeatures[categoryName] = features;
                        }
                    }
                });
            } else if (category === "emlak") {
                 propsContainer.querySelectorAll('h3').forEach(header => {
                    const categoryName = header.innerText.trim();
                    const ul = header.nextElementSibling;
                    if (ul && ul.tagName === 'UL') {
                        const features = [];
                        // Seçili özellikleri al (class="selected")
                        ul.querySelectorAll('li.selected').forEach(li => features.push(li.innerText.trim()));
                        if (features.length > 0) detailedFeatures[categoryName] = features;
                    }
                });
            }
        }

        return { 
            category: category, 
            listingType: listingType,
            url: window.location.href, 
            title, 
            price, 
            basicAttributes, 
            expertReport, 
            features: detailedFeatures, 
            description, 
            images: [...new Set(images)].slice(0, 10) 
        };
    } catch (error) { return { error: error.message }; }
}