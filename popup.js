document.getElementById("btnScrape").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const statusDiv = document.getElementById("status");

    // 1. Kategori Tespiti
    let category = "unknown";
    if (tab.url.includes("/vasita") || tab.url.includes("/otomobil") || tab.url.includes("/arazi-suv")) {
        category = "oto";
    } else if (tab.url.includes("/emlak") || tab.url.includes("/konut") || tab.url.includes("/is-yeri")) {
        category = "emlak";
    }

    if (!tab.url.includes("sahibinden.com/ilan")) {
        statusDiv.innerText = "Lütfen bir ilan detay sayfasına girin.";
        return;
    }

    if (category === "unknown") {
        statusDiv.innerText = "Sadece 'Vasıta' ve 'Emlak' ilanları desteklenmektedir.";
        return;
    }

    // 2. Arka Plana Mesaj Gönder: "Analizi Başlat!"
    chrome.runtime.sendMessage({
        action: "start_analysis",
        tabId: tab.id,
        category: category
    });

    // 3. Pencereyi Kapat (Kullanıcı zaten loading'i sayfada görecek)
    window.close();
});