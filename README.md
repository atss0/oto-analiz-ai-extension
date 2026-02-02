# Sahibinden AI Analiz

![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)
![Tech](https://img.shields.io/badge/AI-GPT_4o-green.svg)
![Platform](https://img.shields.io/badge/platform-Chrome_Extension-orange.svg)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Available-4285F4?logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/detail/njfhlhpflbdfhljkhflkmkjlhgnanlpj?utm_source=item-share-cb)

**sahibinden.com** üzerindeki **Vasıta (Araç)** ve **Emlak (Konut/İş Yeri)** ilanlarını yapay zeka ile analiz eden, ekspertiz raporlarını yorumlayan ve yatırım tavsiyesi sunan gelişmiş bir Chrome Eklentisi.

Bu proje; ilanın kategorisini (Oto/Emlak) ve tipini (Satılık/Kiralık) otomatik algılar. İlanın fiyatını, açıklamasını, teknik özelliklerini ve fotoğraflarını **GPT-4o Vision** modeline göndererek size detaylı bir **Eksper Raporu** sunar.

<p align="center">
  <img src="assets/screenshots/ss-2.png" width="45%" title="Sinematik Loading Ekranı">
  &nbsp; &nbsp; <img src="assets/screenshots/ss-1.png" width="45%" title="AI Analiz Sonucu">
</p>

## Yeni Özellikler (v1.1)

* **Emlak Modu:** Artık sadece arabaları değil; satılık/kiralık daireleri, ofisleri ve arsaları da analiz ediyor.
    * *Satılık:* Yatırım değeri, amortisman ve kredi uygunluğu analizi.
    * *Kiralık:* Aidat, depozito, ısınma ve eşya durumu analizi.
* **Hibrit Mimari:** İlanın otomobil mi yoksa ev mi olduğunu otomatik anlar ve ona göre özel bir AI promptu kullanır.
* **Arka Plan Servisi (Background Worker):** Analiz sırasında başka sekmeye geçseniz veya pencereyi kapatsanız bile işlem arka planda devam eder. Asla yarıda kalmaz.
* **Fotoğraf Analizi:**
    * *Araçlarda:* Kaporta, kozmetik, döşeme yıpranması.
    * *Evlerde:* Rutubet, güneş alma durumu, tadilat ihtiyacı.

## Özellikler

* **Tam Sayfa Analiz:** İlan detay sayfasındaki tüm teknik verileri ve satıcı açıklamasını okur.
* **Gizli Özellik Tespiti:** Satıcının metin arasına gizlediği riskleri (örn: "ağır hasarlı", "tapusu yok", "rutubetli") yakalar.
* **Ekspertiz Entegrasyonu:** Araç ilanlarında "Boyalı/Değişen" tablosunu okur.
* **Sinematik UI:** Sayfa üzerinde modern, animasyonlu bir yükleme ekranı ve sonuç penceresi (Modal) açar.
* **Backend-less Yapı:** n8n veya basit bir API endpoint ile entegre çalışır.

## Kurulum

### Chrome Web Mağazasından Yükle (Önerilen)
Eklentimiz artık resmi olarak yayında! En güncel ve stabil sürümü doğrudan mağazadan güvenle yükleyebilirsiniz:

[<img src="https://img.shields.io/badge/Chrome_Web_Store-Available-4285F4?logo=google-chrome&logoColor=white" width="200" alt="Chrome Web Mağazasında Mevcut">](https://chromewebstore.google.com/detail/njfhlhpflbdfhljkhflkmkjlhgnanlpj?utm_source=item-share-cb)

**[Sahibinden AI Analiz - Mağaza Linki](https://chromewebstore.google.com/detail/njfhlhpflbdfhljkhflkmkjlhgnanlpj?utm_source=item-share-cb)**

### Manuel Kurulum (Geliştirici Sürümü)
Eğer kaynak kodları incelemek veya geliştirmeye katkıda bulunmak isterseniz:

1.  Bu repoyu bilgisayarınıza indirin (Clone veya Download ZIP).
2.  Kullandığınız tarayıcıyı açın ve adres çubuğuna ilgili uzantı adresini yazın:
    * **Google Chrome / Brave:** `chrome://extensions`
    * **Opera:** `opera://extensions`
3.  Sayfanın kenarındaki (genelde sağ üstte) **Geliştirici Modu (Developer Mode)** anahtarını açın.
4.  Sol üstte beliren **Paketlenmemiş öğe yükle (Load unpacked)** butonuna tıklayın.
5.  İndirdiğiniz proje klasörünü seçin.

## Yapılandırma (Önemli)

Eklentinin çalışması için n8n üzerinde kurulan bir workflow'a ihtiyacı vardır. (Mağazadan indiren kullanıcılar için backend tarafımızca sağlanmaktadır, geliştiriciler kendi endpoint'lerini kullanabilir).

**Geliştiriciler için:**
1.  `background.js` dosyasını açın.
2.  Aşağıdaki satırı bulun ve kendi n8n webhook adresinizle değiştirin:
    ```javascript
    const n8nUrl = "YOUR_N8N_WEBHOOK_URL_HERE";
    ```
3.  **n8n Workflow Kurulumu:** Proje dosyasındaki `SahibindenAI.json` dosyasını n8n'e import edin.

## Nasıl Çalışır?

1.  sahibinden.com'da bir ilana girin (Araba veya Ev fark etmez).
2.  Eklenti ikonuna tıklayın ve **"Analizi Başlat"** butonuna basın.
3.  Sayfa üzerinde bir yükleme ekranı belirir. Siz başka işlerinizle ilgilenirken AI arka planda çalışır.
4.  Analiz bittiğinde sonuçlar detaylı bir pencerede (Modal) gösterilir.

## Lisans

Bu proje açık kaynaklıdır ve kullanıma açıktır. Ticari kullanım için OpenAI API maliyetlerini göz önünde bulundurunuz.

---
<div align="center">
  <strong>Coded by ats | HNG Software</strong>
</div>