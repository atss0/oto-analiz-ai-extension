// ==================== HELPERS ====================

function formatTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Az önce';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' dk önce';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' sa önce';
    const d = new Date(ts);
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
}

function scoreColor(s) {
    return s >= 75 ? '#22c55e' : s >= 60 ? '#f59e0b' : s >= 40 ? '#f97316' : '#ef4444';
}

const VERDICT_COLORS = {
    'ALINIR': '#22c55e', 'FIRSAT': '#16a34a',
    'RİSKLİ': '#f97316', 'RISKLI': '#f97316',
    'NORMAL': '#64748b', 'PAHALI': '#f97316', 'UZAK DUR': '#ef4444'
};

function verdictBg(v) {
    if (!v) return '#64748b';
    return VERDICT_COLORS[v.trim()] || VERDICT_COLORS[v.trim().toLocaleUpperCase('tr-TR')] || '#64748b';
}

const catData = {
    oto:        { color: '#3B82F6', label: 'OTO' },
    emlak:      { color: '#10B981', label: 'EML' },
    motosiklet: { color: '#F59E0B', label: 'MOTO' },
    ticari:     { color: '#6366F1', label: 'TİC' },
    tekne:      { color: '#06B6D4', label: 'TEK' },
    elektronik: { color: '#EC4899', label: 'ELK' }
};

function catLabel(cat) {
    const d = catData[cat];
    if (!d) return '';
    return `<span style="background:${d.color}18;color:${d.color};font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;letter-spacing:.3px">${d.label}</span>`;
}

function renderItem(item) {
    const div = document.createElement('div');
    div.className = 'analysis-item';
    div.innerHTML = `
        <div class="ai-item-title">${item.title || 'İlan'}</div>
        <div class="ai-item-meta">
            <span class="ai-item-score" style="color:${scoreColor(item.score)}">${item.score}/100</span>
            <span class="ai-item-verdict" style="background:${verdictBg(item.verdict)}">${item.verdict}</span>
            ${catLabel(item.category)}
            <span class="ai-item-time">${formatTime(item.timestamp)}</span>
        </div>
    `;
    div.addEventListener('click', async () => {
        if (item.analysis) {
            const newTab = await chrome.tabs.create({ url: item.url });
            await chrome.storage.local.set({
                pendingRestore: { ...item, targetTabId: newTab.id, restoreTimestamp: Date.now() }
            });
        } else {
            chrome.tabs.create({ url: item.url });
        }
    });
    return div;
}

// ==================== TAB MANAGEMENT ====================

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'history') loadHistory();
        if (btn.dataset.tab === 'favorites') loadFavorites();
    });
});

// ==================== HISTORY ====================

async function loadHistory() {
    const container = document.getElementById('history-list');
    container.innerHTML = '<div class="list-empty">Yükleniyor...</div>';
    const data = await chrome.storage.local.get('analysisHistory');
    const history = data.analysisHistory || [];
    container.innerHTML = '';
    if (history.length === 0) {
        container.innerHTML = '<div class="list-empty">Henüz analiz yapılmadı.<br>Bir ilan sayfasında "Analizi Başlat" butonuna basın.</div>';
        return;
    }
    history.forEach(item => container.appendChild(renderItem(item)));
}

// ==================== FAVORITES ====================

async function loadFavorites() {
    const container = document.getElementById('favorites-list');
    container.innerHTML = '<div class="list-empty">Yükleniyor...</div>';
    const data = await chrome.storage.local.get('analysisFavorites');
    const favorites = data.analysisFavorites || [];
    container.innerHTML = '';
    if (favorites.length === 0) {
        container.innerHTML = '<div class="list-empty">Favori ilan yok.<br>Analiz raporundaki ⭐ butonuna basarak ekleyin.</div>';
        return;
    }
    favorites.forEach(item => container.appendChild(renderItem(item)));
}

// ==================== MAIN ====================

(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const statusDiv = document.getElementById('status');

    // In-progress durumunu kontrol et (doğrudan storage'dan — service worker kapalı olsa bile çalışır)
    const statusData = await chrome.storage.local.get('analysisInProgress');
    if (statusData.analysisInProgress) {
        const age = Date.now() - (statusData.analysisInProgress.startTime || 0);
        if (age < 35000) {
            document.getElementById('inProgress').style.display = 'flex';
            document.getElementById('btnScrape').disabled = true;
        } else {
            await chrome.storage.local.remove('analysisInProgress');
        }
    }

    document.getElementById('btnScrape').addEventListener('click', async () => {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = currentTab.url || '';

        if (!url.includes('sahibinden.com/ilan')) {
            statusDiv.innerText = 'Lütfen bir ilan detay sayfasına gidin.';
            return;
        }

        // Kategori tespiti — genişletilmiş
        let category = 'unknown';
        if (/\/(vasita|otomobil|arazi-suv|suv)/.test(url)) {
            category = 'oto';
        } else if (/\/motosiklet/.test(url)) {
            category = 'motosiklet';
        } else if (/\/(is-makinasi|kamyon|minibus|ticari-arac|ticari)/.test(url)) {
            category = 'ticari';
        } else if (/\/(tekne|deniz-tasiticilari)/.test(url)) {
            category = 'tekne';
        } else if (/\/(telefon|bilgisayar|elektronik|tablet|oyun-konsolu)/.test(url)) {
            category = 'elektronik';
        } else if (/\/(emlak|konut|is-yeri|arsa|bina)/.test(url)) {
            category = 'emlak';
        }

        if (category === 'unknown') {
            statusDiv.innerText = 'Bu kategori henüz desteklenmiyor.';
            return;
        }

        chrome.runtime.sendMessage({
            action: 'start_analysis',
            tabId: currentTab.id,
            category,
            url
        });

        window.close();
    });
})();
