// ==================== STATE MANAGEMENT ====================

async function getRateLimit(url) {
    const data = await chrome.storage.local.get('rateLimits');
    const limits = data.rateLimits || {};
    return limits[url] || 0;
}

async function setRateLimit(url) {
    const data = await chrome.storage.local.get('rateLimits');
    const limits = data.rateLimits || {};
    limits[url] = Date.now();
    await chrome.storage.local.set({ rateLimits: limits });
}

async function getInProgress() {
    const data = await chrome.storage.local.get('analysisInProgress');
    return data.analysisInProgress || null;
}

async function setInProgress(info) {
    await chrome.storage.local.set({ analysisInProgress: info });
}

async function clearInProgress() {
    await chrome.storage.local.remove('analysisInProgress');
}

async function saveToHistory(item) {
    const data = await chrome.storage.local.get('analysisHistory');
    let history = data.analysisHistory || [];
    history = history.filter(h => h.url !== item.url);
    history.unshift(item);
    if (history.length > 20) history = history.slice(0, 20);
    await chrome.storage.local.set({ analysisHistory: history });
}

async function addToFavorites(item) {
    const data = await chrome.storage.local.get('analysisFavorites');
    let favorites = data.analysisFavorites || [];
    favorites = favorites.filter(f => f.url !== item.url);
    favorites.unshift(item);
    await chrome.storage.local.set({ analysisFavorites: favorites });
}

async function removeFromFavorites(url) {
    const data = await chrome.storage.local.get('analysisFavorites');
    const favorites = (data.analysisFavorites || []).filter(f => f.url !== url);
    await chrome.storage.local.set({ analysisFavorites: favorites });
}

async function checkIsFavorite(url) {
    const data = await chrome.storage.local.get('analysisFavorites');
    return (data.analysisFavorites || []).some(f => f.url === url);
}

// ==================== MESSAGE HANDLER ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "start_analysis") {
        runAnalysisProcess(request.tabId, request.category, request.url);
    }
    if (request.action === "add_favorite") {
        addToFavorites(request.item).then(() => sendResponse({ success: true }));
        return true;
    }
    if (request.action === "remove_favorite") {
        removeFromFavorites(request.url).then(() => sendResponse({ success: true }));
        return true;
    }
    if (request.action === "get_history") {
        chrome.storage.local.get('analysisHistory').then(data => {
            sendResponse({ history: data.analysisHistory || [] });
        });
        return true;
    }
    if (request.action === "get_favorites") {
        chrome.storage.local.get('analysisFavorites').then(data => {
            sendResponse({ favorites: data.analysisFavorites || [] });
        });
        return true;
    }
    if (request.action === "get_status") {
        getInProgress().then(inProgress => sendResponse({ inProgress }));
        return true;
    }
});

// ==================== TAB RESTORE ====================

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    if (!tab.url?.includes('sahibinden.com/ilan')) return;

    const data = await chrome.storage.local.get('pendingRestore');
    if (!data.pendingRestore) return;

    const pending = data.pendingRestore;

    // Discard stale entries (older than 5 minutes)
    if (Date.now() - (pending.restoreTimestamp || 0) > 300000) {
        await chrome.storage.local.remove('pendingRestore');
        return;
    }

    if (pending.targetTabId !== tabId) return;
    if (!pending.analysis) {
        await chrome.storage.local.remove('pendingRestore');
        return;
    }

    await chrome.storage.local.remove('pendingRestore');

    const inFavorites = await checkIsFavorite(pending.url);

    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: showResultModal,
            args: [pending.analysis, pending.url, inFavorites, true, tabId, pending.category]
        });
    } catch (e) {
        console.error('Restore inject error:', e);
    }
});

// ==================== MAIN ANALYSIS PROCESS ====================

async function runAnalysisProcess(tabId, category, url) {
    try {
        // Rate limiting: 60 saniye
        const lastAnalysis = await getRateLimit(url);
        if (lastAnalysis > 0 && Date.now() - lastAnalysis < 60000) {
            const remaining = Math.ceil((60000 - (Date.now() - lastAnalysis)) / 1000);
            await chrome.scripting.executeScript({
                target: { tabId },
                func: showErrorCard,
                args: [`Bu ilan ${remaining} saniye sonra tekrar analiz edilebilir.`]
            });
            return;
        }

        // In-progress kontrolü (35 saniyeden eski olanı temizle)
        const existing = await getInProgress();
        if (existing) {
            if (Date.now() - existing.startTime < 35000) {
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: showErrorCard,
                    args: ["Bir analiz zaten devam ediyor. Lütfen bekleyin."]
                });
                return;
            }
            await clearInProgress();
        }
        await setInProgress({ tabId, url, startTime: Date.now() });

        // Loading ekranı
        await chrome.scripting.executeScript({
            target: { tabId },
            func: showFullPageLoading,
            args: [category]
        });

        // Veri çek
        const scrapeResult = await chrome.scripting.executeScript({
            target: { tabId },
            func: scrapeListingData,
            args: [category]
        });

        if (!scrapeResult?.[0]?.result) throw new Error("Veri çekilemedi.");
        const scrapedData = scrapeResult[0].result;
        if (scrapedData.error) throw new Error("Sayfa okunamadı: " + scrapedData.error);

        // n8n'e gönder (30 saniye timeout)
        const n8nUrl = "https://n8n.crmprojesi.fun/webhook/analyze";
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        let response, result;
        try {
            response = await fetch(n8nUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(scrapedData),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            // Decode response with UTF-8; fall back to Windows-1254 (Turkish) if bytes are invalid
            const buffer = await response.arrayBuffer();
            let jsonText;
            try {
                jsonText = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            } catch {
                jsonText = new TextDecoder('windows-1254').decode(buffer);
            }
            result = JSON.parse(jsonText);
        } catch (fetchErr) {
            clearTimeout(timeoutId);
            if (fetchErr.name === 'AbortError') throw new Error("Sunucu 30 saniye içinde yanıt vermedi. Tekrar deneyin.");
            throw fetchErr;
        }

        if (response.ok && result.status === "success") {
            await setRateLimit(url);
            await saveToHistory({
                url,
                title: scrapedData.title || "İlan",
                score: result.analysis.score,
                verdict: result.analysis.verdict,
                category,
                timestamp: Date.now(),
                analysis: result.analysis
            });
            const inFavorites = await checkIsFavorite(url);
            await chrome.scripting.executeScript({
                target: { tabId },
                func: showResultModal,
                args: [result.analysis, url, inFavorites]
            });
        } else {
            throw new Error(result.error || "Sunucu hatası");
        }

    } catch (err) {
        console.error("Background Hatası:", err);
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                func: showErrorCard,
                args: [err.message]
            });
        } catch (_) {}
    } finally {
        await clearInProgress();
    }
}

// ==================== INJECTED: LOADING ====================

function showFullPageLoading(category) {
    document.getElementById('ai-loading-overlay')?.remove();

    const steps = {
        oto: ["Araç verileri toplanıyor...", "HD Fotoğraflar taranıyor...", "Hasar kaydı kontrol ediliyor...", "Ekspertiz raporu okunuyor...", "AI Puanlıyor...", "Rapor hazırlanıyor..."],
        motosiklet: ["Motosiklet verileri toplanıyor...", "Fotoğraflar taranıyor...", "Teknik durum analiz ediliyor...", "Fiyat değerlendiriliyor...", "AI Puanlıyor...", "Rapor hazırlanıyor..."],
        ticari: ["Ticari araç verileri toplanıyor...", "Fotoğraflar taranıyor...", "Teknik durum analiz ediliyor...", "Fiyat değerlendiriliyor...", "AI Puanlıyor...", "Rapor hazırlanıyor..."],
        tekne: ["Tekne verileri toplanıyor...", "Fotoğraflar taranıyor...", "Teknik durum analiz ediliyor...", "Fiyat değerlendiriliyor...", "AI Puanlıyor...", "Rapor hazırlanıyor..."],
        elektronik: ["Cihaz verileri toplanıyor...", "Fotoğraflar taranıyor...", "Kondisyon analiz ediliyor...", "Fiyat değerlendiriliyor...", "AI Puanlıyor...", "Rapor hazırlanıyor..."],
        emlak: ["Emlak verileri toplanıyor...", "Oda ve m² analiz ediliyor...", "Konum ve cephe kontrol ediliyor...", "Fotoğraflardaki kusurlar aranıyor...", "Fiyat analizi yapılıyor...", "Rapor hazırlanıyor..."]
    };
    const currentSteps = steps[category] || steps.oto;

    const overlay = document.createElement('div');
    overlay.id = 'ai-loading-overlay';
    overlay.innerHTML = `
        <div class="ai-ldr-container">
            <div class="ai-ldr-spinner"></div>
            <div class="ai-ldr-text" id="ai-ldr-text">${currentSteps[0]}</div>
            <div class="ai-ldr-bar"><div class="ai-ldr-fill"></div></div>
            <div class="ai-ldr-footer">Coded by <b>ats</b> | HNG Software</div>
        </div>
        <style>
            #ai-loading-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.88);backdrop-filter:blur(8px);z-index:2147483647;display:flex;justify-content:center;align-items:center;font-family:'Segoe UI',sans-serif;color:#fff;animation:aiLdrFade .4s ease}
            .ai-ldr-container{text-align:center;display:flex;flex-direction:column;align-items:center}
            .ai-ldr-spinner{width:56px;height:56px;border:4px solid rgba(255,255,255,.12);border-top:4px solid #FFE800;border-radius:50%;animation:aiLdrSpin 1s linear infinite;margin-bottom:20px}
            .ai-ldr-text{font-size:17px;font-weight:500;letter-spacing:.3px;margin-bottom:14px;min-width:260px;transition:opacity .3s}
            .ai-ldr-bar{width:220px;height:4px;background:rgba(255,255,255,.18);border-radius:2px;overflow:hidden;margin-bottom:28px}
            .ai-ldr-fill{height:100%;background:#FFE800;width:0%;animation:aiLdrProg 9s ease-in-out forwards}
            .ai-ldr-footer{position:fixed;bottom:28px;font-size:11px;color:rgba(255,255,255,.4)}
            .ai-ldr-footer b{color:rgba(255,255,255,.7)}
            @keyframes aiLdrSpin{to{transform:rotate(360deg)}}
            @keyframes aiLdrFade{from{opacity:0}to{opacity:1}}
            @keyframes aiLdrProg{0%{width:0}50%{width:65%}100%{width:92%}}
        </style>
    `;
    document.body.appendChild(overlay);

    let i = 0;
    const el = document.getElementById('ai-ldr-text');
    const iv = setInterval(() => {
        i++;
        if (i >= currentSteps.length) { clearInterval(iv); return; }
        if (el) el.innerText = currentSteps[i];
    }, 2200);

    new MutationObserver(() => {
        if (!document.body.contains(overlay)) { clearInterval(iv); }
    }).observe(document.body, { childList: true });
}

// ==================== INJECTED: RESULT MODAL ====================

function showResultModal(data, listingUrl, initiallyFavorited, isRestore, restoreTabId, restoreCategory) {
    document.getElementById('ai-loading-overlay')?.remove();
    document.getElementById('ai-analysis-modal')?.remove();

    const score = data.score ?? 0;
    const verdict = data.verdict ?? "SONUÇ YOK";
    const summary = data.summary ?? "";
    const subScores = data.sub_scores ?? {};
    const fiyatDeg = data.fiyat_degerlendirmesi ?? "";
    const teknikDurum = data.teknik_durum ?? "";
    const fotografBulgulari = data.fotograf_bulgulari ?? "";
    const gizliRiskler = data.gizli_riskler ?? [];
    const isSuspicious = data.is_suspicious ?? false;
    const pros = data.pros ?? [];
    const cons = data.cons ?? [];

    const scoreColor = score >= 75 ? '#22c55e' : score >= 60 ? '#f59e0b' : score >= 40 ? '#f97316' : '#ef4444';

    const verdictMap = { 'ALINIR': '#22c55e', 'FIRSAT': '#16a34a', 'RİSKLİ': '#f97316', 'RISKLI': '#f97316', 'NORMAL': '#64748b', 'PAHALI': '#f97316', 'UZAK DUR': '#ef4444' };
    const verdictColor = verdictMap[verdict?.trim()] ?? verdictMap[verdict?.trim()?.toLocaleUpperCase('tr-TR')] ?? '#64748b';

    const barHTML = [
        { k: 'fiyat', l: 'Fiyat', i: '💰' },
        { k: 'teknik', l: 'Teknik', i: '⚙️' },
        { k: 'risk', l: 'Risk', i: '🛡️' },
        { k: 'fotograf', l: 'Fotoğraf', i: '📷' }
    ].map(({ k, l, i }) => {
        const v = subScores[k] ?? 0;
        const c = v >= 75 ? '#22c55e' : v >= 60 ? '#f59e0b' : v >= 40 ? '#f97316' : '#ef4444';
        return `<div class="ai-sbar-row"><span class="ai-sbar-lbl">${i} ${l}</span><div class="ai-sbar-track"><div class="ai-sbar-fill" style="width:${v}%;background:${c}"></div></div><span class="ai-sbar-val" style="color:${c}">${v}</span></div>`;
    }).join('');

    const prosHTML = pros.length
        ? pros.map(p => `<li class="ai-li ai-li-pro"><span class="ai-dot" style="color:#22c55e">●</span><span>${p}</span></li>`).join('')
        : '<li class="ai-li">Bilgi bulunamadı.</li>';

    const consHTML = cons.length
        ? cons.map(c => `<li class="ai-li ai-li-con"><span class="ai-dot" style="color:#f97316">●</span><span>${c}</span></li>`).join('')
        : '<li class="ai-li">Bilgi bulunamadı.</li>';

    const gizliHTML = gizliRiskler.length
        ? `<div class="ai-section ai-section-risk"><h3 class="ai-sec-title">🔴 Gizli Riskler</h3><ul class="ai-list">${gizliRiskler.map(r => `<li class="ai-li ai-li-risk"><span class="ai-dot" style="color:#ef4444">●</span><span>${r}</span></li>`).join('')}</ul></div>`
        : '';

    const suspHTML = isSuspicious
        ? `<div class="ai-suspicious">⚠️ <strong>Şüpheli İlan:</strong> Bu ilanın sahte veya yanıltıcı olabileceği tespit edildi. Dikkatli olun.</div>`
        : '';

    const restoreBarHTML = isRestore ? `
  <div class="ai-restore-bar">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3"/></svg>
    <span>Kaydedilmiş analiz görüntüleniyor</span>
    <button id="ai-btn-reanalyze">Yeniden Analiz Et</button>
  </div>` : '';

    const overlay = document.createElement('div');
    overlay.id = 'ai-analysis-modal';

    overlay.innerHTML = `
<div id="ai-modal-inner">
  <div class="ai-mhdr">
    <div class="ai-score-wrap">
      <div class="ai-score-circle" style="border-color:${scoreColor};color:${scoreColor}">${score}</div>
      <div>
        <div class="ai-verdict-badge" style="background:${verdictColor}">${verdict}</div>
        <div class="ai-score-label">/ 100</div>
      </div>
    </div>
    <button id="ai-close-x" class="ai-close-btn">✕</button>
  </div>
  ${suspHTML}
  ${restoreBarHTML}
  <div class="ai-tabs">
    <button class="ai-tab active" data-tab="ozet">Özet</button>
    <button class="ai-tab" data-tab="analiz">Analiz</button>
    <button class="ai-tab" data-tab="fotograf">Fotoğraf</button>
  </div>
  <div class="ai-tab-body" id="ai-tb-ozet">
    <div class="ai-section">
      <p class="ai-summary">${summary}</p>
    </div>
    <div class="ai-section">
      <h3 class="ai-sec-title">Skor Detayı</h3>
      <div class="ai-sbars">${barHTML}</div>
    </div>
    ${fiyatDeg ? `<div class="ai-section"><h3 class="ai-sec-title">💰 Fiyat Değerlendirmesi</h3><p class="ai-detail-p">${fiyatDeg}</p></div>` : ''}
  </div>
  <div class="ai-tab-body ai-hidden" id="ai-tb-analiz">
    ${teknikDurum ? `<div class="ai-section"><h3 class="ai-sec-title">⚙️ Teknik Durum</h3><p class="ai-detail-p">${teknikDurum}</p></div>` : ''}
    <div class="ai-section">
      <h3 class="ai-sec-title">✅ Avantajlar</h3>
      <ul class="ai-list">${prosHTML}</ul>
    </div>
    <div class="ai-section">
      <h3 class="ai-sec-title">⚠️ Riskler</h3>
      <ul class="ai-list">${consHTML}</ul>
    </div>
    ${gizliHTML}
  </div>
  <div class="ai-tab-body ai-hidden" id="ai-tb-fotograf">
    <div class="ai-section">
      <h3 class="ai-sec-title">📷 Fotoğraf Analizi</h3>
      <p class="ai-detail-p">${fotografBulgulari || 'Fotoğraf analizi bu yanıtta mevcut değil.'}</p>
    </div>
  </div>
  <div class="ai-mftr">
    <div class="ai-ftr-acts">
      <button class="ai-act-btn" id="ai-btn-copy">📋 Kopyala</button>
      <button class="ai-act-btn" id="ai-btn-print">🖨️ Yazdır</button>
      <button class="ai-act-btn ${initiallyFavorited ? 'ai-fav-active' : ''}" id="ai-btn-fav">${initiallyFavorited ? '⭐ Favoride' : '☆ Favori'}</button>
    </div>
    <span class="ai-ftr-credit">Coded by <b>ats</b> | HNG Software</span>
  </div>
</div>
<style>
#ai-analysis-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.78);z-index:2147483647;display:flex;justify-content:center;align-items:center;font-family:'Segoe UI',system-ui,sans-serif;backdrop-filter:blur(6px);animation:aiMFadeIn .3s ease}
#ai-modal-inner{background:#fff;color:#1a202c;width:92%;max-width:640px;max-height:88vh;border-radius:18px;box-shadow:0 24px 64px rgba(0,0,0,.45);overflow:hidden;display:flex;flex-direction:column;animation:aiMSlideUp .3s ease}
.ai-mhdr{padding:18px 20px 0;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
.ai-score-wrap{display:flex;align-items:center;gap:14px}
.ai-score-circle{width:62px;height:62px;border-radius:50%;border:4px solid;display:flex;justify-content:center;align-items:center;font-size:23px;font-weight:800;background:transparent}
.ai-verdict-badge{display:inline-block;padding:4px 13px;border-radius:20px;color:#fff;font-size:12px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;margin-bottom:2px}
.ai-score-label{font-size:11px;color:var(--ai-muted,#94a3b8)}
.ai-close-btn{background:none;border:none;font-size:20px;cursor:pointer;color:var(--ai-muted,#94a3b8);padding:4px 6px;line-height:1;border-radius:6px}
.ai-close-btn:hover{background:var(--ai-sec-bg,#f1f5f9);color:var(--ai-text,#1a202c)}
.ai-suspicious{margin:10px 20px 0;padding:10px 14px;background:var(--ai-susp,#fef3c7);border:1px solid #f59e0b;border-radius:8px;font-size:13px;color:#92400e}
.ai-restore-bar{display:flex;align-items:center;gap:7px;padding:8px 20px;background:#FFF8E1;border-bottom:1px solid #FFE800;font-size:11.5px;color:#78350F;flex-shrink:0}
.ai-restore-bar button{margin-left:auto;background:#FFE800;border:none;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;cursor:pointer;color:#1a202c;font-family:inherit;white-space:nowrap}
.ai-restore-bar button:hover{background:#FFD91A}
.ai-tabs{display:flex;gap:2px;padding:10px 20px 0;border-bottom:1px solid var(--ai-border,#e2e8f0);flex-shrink:0}
.ai-tab{padding:7px 16px;border:none;cursor:pointer;font-size:13px;font-weight:600;border-radius:7px 7px 0 0;background:transparent;color:var(--ai-muted,#94a3b8);transition:.2s}
.ai-tab.active{background:var(--ai-sec-bg,#f8fafc);color:var(--ai-text,#1a202c);border-bottom:2.5px solid #FFE800}
.ai-tab:hover:not(.active){background:var(--ai-sec-bg,#f1f5f9)}
.ai-tab-body{flex:1;overflow-y:auto;overscroll-behavior:contain}
.ai-hidden{display:none}
.ai-section{padding:14px 20px;border-bottom:1px solid var(--ai-border,#eee)}
.ai-section:last-child{border-bottom:none}
.ai-sec-title{font-size:13px;font-weight:700;margin-bottom:10px;color:var(--ai-text,#1e293b)}
.ai-summary{font-size:14px;line-height:1.7;background:var(--ai-sum-bg,#fffbea);padding:12px 14px;border-left:3px solid #FFE800;border-radius:4px;color:var(--ai-text,#374151)}
.ai-detail-p{font-size:13.5px;line-height:1.65;color:var(--ai-text,#4b5563)}
.ai-sbars{display:flex;flex-direction:column;gap:9px}
.ai-sbar-row{display:flex;align-items:center;gap:10px}
.ai-sbar-lbl{font-size:12px;width:82px;color:var(--ai-muted,#64748b);flex-shrink:0}
.ai-sbar-track{flex:1;height:7px;background:var(--ai-border,#e2e8f0);border-radius:4px;overflow:hidden}
.ai-sbar-fill{height:100%;border-radius:4px;transition:width .6s ease}
.ai-sbar-val{font-size:12px;font-weight:700;width:26px;text-align:right}
.ai-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:5px}
.ai-li{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.55;padding:6px 8px;border-radius:6px}
.ai-li-pro{background:rgba(34,197,94,.06)}
.ai-li-con{background:rgba(249,115,22,.06)}
.ai-li-risk{background:var(--ai-risk-sec,rgba(239,68,68,.07))}
.ai-dot{font-size:9px;margin-top:4px;flex-shrink:0}
.ai-section-risk{background:var(--ai-risk-sec,rgba(239,68,68,.04))}
.ai-mftr{padding:11px 20px;background:var(--ai-ftr-bg,#f8fafc);border-top:1px solid var(--ai-border,#e2e8f0);display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
.ai-ftr-acts{display:flex;gap:7px}
.ai-act-btn{padding:5px 11px;border-radius:7px;border:1px solid var(--ai-border,#e2e8f0);background:var(--ai-sec-bg,#fff);color:var(--ai-text,#374151);font-size:11.5px;cursor:pointer;transition:.2s}
.ai-act-btn:hover{border-color:#FFE800}
.ai-fav-active{background:#fef9c3 !important;border-color:#FFE800 !important}
.ai-ftr-credit{font-size:10.5px;color:var(--ai-ftr-txt,#94a3b8)}
.ai-ftr-credit b{color:var(--ai-muted,#64748b)}
@keyframes aiMFadeIn{from{opacity:0}to{opacity:1}}
@keyframes aiMSlideUp{from{transform:translateY(18px);opacity:0}to{transform:translateY(0);opacity:1}}
@media print{#ai-analysis-modal{position:absolute;background:white!important;backdrop-filter:none}#ai-modal-inner{box-shadow:none;max-height:none}.ai-mftr,.ai-tabs,.ai-mhdr .ai-close-btn{display:none!important}.ai-tab-body.ai-hidden{display:block!important}}
</style>
    `;

    document.body.appendChild(overlay);

    // Kapat
    document.getElementById('ai-close-x').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // Tab geçişi
    overlay.querySelectorAll('.ai-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            overlay.querySelectorAll('.ai-tab').forEach(b => b.classList.remove('active'));
            overlay.querySelectorAll('.ai-tab-body').forEach(c => c.classList.add('ai-hidden'));
            btn.classList.add('active');
            overlay.querySelector('#ai-tb-' + btn.dataset.tab).classList.remove('ai-hidden');
        });
    });

    // Kopyala
    document.getElementById('ai-btn-copy').addEventListener('click', () => {
        const txt = [
            `=== AI ANALİZ RAPORU ===`,
            `Skor: ${score}/100 | Karar: ${verdict}`,
            ``,
            `ÖZET:\n${summary}`,
            fiyatDeg ? `\nFİYAT:\n${fiyatDeg}` : '',
            teknikDurum ? `\nTEKNİK DURUM:\n${teknikDurum}` : '',
            fotografBulgulari ? `\nFOTOĞRAF BULGULARI:\n${fotografBulgulari}` : '',
            pros.length ? `\nAVANTAJLAR:\n${pros.map(p => '✅ ' + p).join('\n')}` : '',
            cons.length ? `\nRİSKLER:\n${cons.map(c => '⚠️ ' + c).join('\n')}` : '',
            gizliRiskler.length ? `\nGİZLİ RİSKLER:\n${gizliRiskler.map(r => '🔴 ' + r).join('\n')}` : '',
            `\nKaynak: ${listingUrl}`
        ].filter(Boolean).join('\n');
        navigator.clipboard.writeText(txt).then(() => {
            const btn = document.getElementById('ai-btn-copy');
            btn.textContent = '✅ Kopyalandı';
            setTimeout(() => { btn.textContent = '📋 Kopyala'; }, 2500);
        });
    });

    // Yazdır
    document.getElementById('ai-btn-print').addEventListener('click', () => window.print());

    // Favori
    let isFav = initiallyFavorited;
    const favBtn = document.getElementById('ai-btn-fav');
    favBtn.addEventListener('click', () => {
        if (isFav) {
            chrome.runtime.sendMessage({ action: 'remove_favorite', url: listingUrl });
            favBtn.textContent = '☆ Favori';
            favBtn.classList.remove('ai-fav-active');
        } else {
            chrome.runtime.sendMessage({
                action: 'add_favorite',
                item: {
                    url: listingUrl,
                    title: document.title || 'İlan',
                    score, verdict,
                    timestamp: Date.now(),
                    analysis: data
                }
            });
            favBtn.textContent = '⭐ Favoride';
            favBtn.classList.add('ai-fav-active');
        }
        isFav = !isFav;
    });

    // Yeniden Analiz Et
    if (isRestore) {
        document.getElementById('ai-btn-reanalyze').addEventListener('click', () => {
            overlay.remove();
            chrome.runtime.sendMessage({
                action: 'start_analysis',
                tabId: restoreTabId,
                category: restoreCategory,
                url: listingUrl
            });
        });
    }
}

// ==================== INJECTED: ERROR CARD ====================

function showErrorCard(message) {
    document.getElementById('ai-loading-overlay')?.remove();
    document.getElementById('ai-error-card')?.remove();

    const card = document.createElement('div');
    card.id = 'ai-error-card';
    card.innerHTML = `
        <div class="ai-err-inner">
            <div class="ai-err-body">
                <div class="ai-err-title">⚠️ Hata</div>
                <div class="ai-err-msg">${message}</div>
            </div>
            <button id="ai-err-x">×</button>
        </div>
        <style>
            #ai-error-card{position:fixed;top:20px;right:20px;z-index:2147483647;font-family:'Segoe UI',sans-serif;animation:aiErrIn .3s ease;max-width:340px}
            .ai-err-inner{background:#fff;border:1px solid #fee2e2;border-left:4px solid #ef4444;padding:14px 16px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.15);display:flex;gap:12px;align-items:flex-start}
            .ai-err-body{flex:1}
            .ai-err-title{font-weight:700;color:#ef4444;font-size:13px;margin-bottom:4px}
            .ai-err-msg{font-size:12.5px;color:#374151;line-height:1.45}
            #ai-err-x{background:none;border:none;cursor:pointer;font-size:20px;color:#94a3b8;padding:0;line-height:1;flex-shrink:0}
            @keyframes aiErrIn{from{transform:translateX(16px);opacity:0}to{transform:translateX(0);opacity:1}}
        </style>
    `;
    document.body.appendChild(card);
    document.getElementById('ai-err-x').addEventListener('click', () => card.remove());
    setTimeout(() => card?.remove(), 9000);
}

// ==================== INJECTED: SCRAPER ====================

function scrapeListingData(category) {
    try {
        // Fallback selectors ile başlık
        const title = (
            document.querySelector('.classifiedDetailTitle h1') ||
            document.querySelector('[class*="classified-detail"] h1') ||
            document.querySelector('[class*="ClassifiedDetail"] h1') ||
            document.querySelector('h1')
        )?.innerText?.trim();

        // Fallback selectors ile fiyat
        const price = (
            document.querySelector('.classified-price-wrapper') ||
            document.querySelector('[class*="price-wrapper"]') ||
            document.querySelector('[class*="classifiedPrice"]') ||
            document.querySelector('[class*="classified-price"]')
        )?.innerText?.trim();

        // Açıklama
        const descEl = document.getElementById('classifiedDescription') ||
            document.querySelector('[id*="classifiedDescription"]') ||
            document.querySelector('[class*="classified-description"]');
        let description = descEl
            ? descEl.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n')
            : "";

        // Temel özellikler
        const basicAttributes = {};
        const attrSelectors = [
            '.classifiedInfoList li',
            '[class*="classifiedInfoList"] li',
            '[class*="classified-info-list"] li'
        ];
        let attrItems = null;
        for (const sel of attrSelectors) {
            attrItems = document.querySelectorAll(sel);
            if (attrItems.length > 0) break;
        }
        if (attrItems) {
            attrItems.forEach(item => {
                const key = item.querySelector('strong')?.innerText?.trim();
                const value = item.querySelector('span')?.innerText?.trim();
                if (key && value) basicAttributes[key] = value;
            });
        }

        // Fotoğraflar
        const images = [];
        const imgSelectors = [
            '.classifiedDetailMainPhoto img',
            '.classifiedDetailThumbList img',
            '[class*="ClassifiedDetail"] img',
            '[class*="classified-photos"] img'
        ];
        for (const sel of imgSelectors) {
            document.querySelectorAll(sel).forEach(img => {
                if (img.src && !img.src.includes("assets/images/blank") && !img.src.includes("data:")) {
                    images.push(img.src.replace("thmb_", "x5_").replace("stnd_", "x5_"));
                }
            });
        }

        let expertReport = [];
        const detailedFeatures = {};

        // İlan tipi (emlak)
        let listingType = "Bilinmiyor";
        if (category === "emlak") {
            const bcItems = document.querySelectorAll('.search-result-bc .bc-item a, [class*="breadcrumb"] a');
            for (const bc of bcItems) {
                const t = bc.innerText.trim().toLocaleLowerCase('tr-TR');
                if (t === "kiralık") { listingType = "Kiralık"; break; }
                if (t === "satılık") { listingType = "Satılık"; break; }
                if (t === "günlük kiralık") { listingType = "Günlük Kiralık"; break; }
                if (t === "devren") { listingType = "Devren"; break; }
            }
            if (listingType === "Bilinmiyor" && basicAttributes['Emlak Tipi']) {
                const emlakTipi = basicAttributes['Emlak Tipi'] || '';
                if (emlakTipi.toLocaleLowerCase('tr-TR').includes('kiralık')) listingType = "Kiralık";
                else if (emlakTipi.toLocaleLowerCase('tr-TR').includes('satılık')) listingType = "Satılık";
            }
        }

        // Detaylı özellikler
        const propsContainer = document.getElementById('classifiedProperties') ||
            document.querySelector('[id*="classifiedProperties"]');

        if (propsContainer) {
            if (category === "oto" || category === "motosiklet" || category === "ticari" || category === "tekne") {
                propsContainer.querySelectorAll('h3').forEach(header => {
                    const catName = header.innerText.trim();
                    if (catName.includes("Boyalı") || catName.includes("Değişen")) {
                        const dmg = propsContainer.querySelector('.car-damage-info-list li.selected-damage')?.innerText;
                        if (dmg) expertReport.push(dmg.trim());
                        else {
                            propsContainer.querySelector('.car-damage-info-list ul')?.querySelectorAll('li').forEach(li => expertReport.push(li.innerText.trim()));
                        }
                    } else {
                        const ul = header.nextElementSibling;
                        if (ul?.tagName === 'UL') {
                            const feats = [];
                            ul.querySelectorAll('li').forEach(li => feats.push(li.innerText.trim()));
                            if (feats.length > 0) detailedFeatures[catName] = feats;
                        }
                    }
                });
            } else if (category === "emlak") {
                propsContainer.querySelectorAll('h3').forEach(header => {
                    const catName = header.innerText.trim();
                    const ul = header.nextElementSibling;
                    if (ul?.tagName === 'UL') {
                        const feats = [];
                        ul.querySelectorAll('li.selected').forEach(li => feats.push(li.innerText.trim()));
                        if (feats.length > 0) detailedFeatures[catName] = feats;
                    }
                });
            }
        }

        return {
            category,
            listingType,
            url: window.location.href,
            title,
            price,
            basicAttributes,
            expertReport,
            features: detailedFeatures,
            description,
            images: [...new Set(images)].slice(0, 10)
        };
    } catch (e) {
        return { error: e.message };
    }
}
