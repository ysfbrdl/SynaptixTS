# 💎 SynaptixTS — AI-Native E2E Test Automation Framework

**SynaptixTS**, Playwright ve Google Gemini 2.5 Yapay Zeka motorunu birleştiren, doğal dilde yazılmış test senaryolarını sıfır bakım maliyetiyle icra eden **Next-Gen E2E Test Otomasyon Çerçevesidir**.

---

## 🌟 Öne Çıkan Özellikler (Key Features)

- 🧠 **Doğal Dil Senaryoları (YAML):** Testlerinizi kod yazmadan, tamamen günlük konuşma dilinde (Türkçe/İngilizce) YAML dosyaları olarak tanımlayın.
- ⚡ **Katmanlı Akıllı Önbellek (Layered Smart Cache):** 
  - `shared_cache.json`: Giriş/oturum açma gibi ortak adımları merkezi olarak saklar.
  - `.cache/scenarios/${scenario_name}.json`: Senaryoya özel adımları önbellekler.
  - Başarılı adımlar sonraki koşumlarda **~100ms** hızında yapay zekaya hiç gitmeden çalışır.
- 🔄 **Kendi Kendini Onarma (Self-Healing):** Arayüz (UI) değiştiğinde veya buton isimleri güncellendiğinde sistem eski kaydı önbellekten siler, Gemini 2.5 ile canlı DOM ve ekran görüntüsünü analiz ederek yeni seçiciyi bulur ve testi kırılmaktan kurtarır.
- 🛡️ **Doğrulanmış Önbellek Kaydı (Post-Execution Caching):** Yapay zeka kararları yalnızca ve yalnızca canlı sayfada icra edilip **PASSED** olduktan sonra önbelleğe kaydedilir. Hatalı veya yarım kalmış adımlar önbelleğe yazılmaz.
- 🚀 **Direkt Yönlendirme Hızlı Yolu (Direct Navigation Fast-Path):** `Go to...` veya `Navigate to...` adımları yapay zekaya sormadan **0.1 saniyede** doğrudan Playwright `page.goto()` ile icra edilir.
- 🧹 **Toast Mesajı & Yükleme Süpürücü (Toast & Loader Auto-Clearing):** Ekranı ve butonların önünü kapatan yüzen bildirim mesajları (`.p-toast`, `.ngx-toastr`, `mat-snack-bar`) otomatik olarak DOM'dan kaldırılır, sayfa yükleme barları dinamik beklenir.
- 🎯 **Kapsamlı Bileşik Seçici (Composite Fallback Locators):** `role=button`, `name`, `description`, `title`, `aria-label` ve metin eşleşmelerini `.or()` zinciriyle tek seferde paralel kontrol eder.
- 📊 **Zengin HTML Raporlama:** Her koşum sonrasında adım detaylarını, süreleri ve hata anı ekran görüntülerini içeren HTML raporu üretir.

---

## 📁 Proje Yapısı (Project Architecture)

```text
SynaptixTS/
├── .cache/                     # Akıllı önbellek dizini
│   ├── shared_cache.json       # Ortak oturum/giriş adımları önbelleği
│   └── scenarios/              # Senaryo bazlı önbellek dosyaları (.json)
├── reports/                    # Test koşum HTML raporları ve ekran görüntüleri
├── scenarios/                  # YAML formatındaki doğal dil test senaryoları
│   ├── bus_policy_verification.yaml
│   └── optimus_dashboard_details.yaml
├── src/
│   ├── core/
│   │   ├── BrainService.ts     # Gemini 2.5 Flash / Pro entegrasyonu & key rotasyonu
│   │   ├── DomTrimmer.ts       # Erişilebilirlik (ARIA Snapshot) DOM sıkıştırma
│   │   ├── HtmlReportService.ts# HTML Rapor oluşturucu servis
│   │   ├── PlaywrightManager.ts# Tarayıcı yönetimi & akıllı seçici (Smart Locator) motoru
│   │   ├── SmartCache.ts       # Katmanlı hybrid önbellek yönetimi
│   │   └── TestRunner.ts       # Test yürütücü, self-healing & dinamik veri motoru
│   ├── types/                  # TypeScript tip tanımlamaları
│   └── index.ts                # Çerçeve ana giriş noktası (CLI Entrypoint)
├── .env                        # Gemini API Anahtarları ve ortam değişkenleri
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🚀 Kurulum (Setup)

### 1. Bağımlılıkları Yükleyin

```powershell
npm install
```

### 2. Ortam Değişkenlerini (`.env`) Ayarlayın

Kök dizinde bir `.env` dosyası oluşturun ve Gemini API anahtarınızı (veya çoklu rotasyon anahtarlarınızı) ekleyin:

```env
GEMINI_API_KEY=AIzaSyYourPrimaryGeminiApiKeyHere
GEMINI_API_KEY_2=AIzaSyYourSecondaryGeminiApiKeyHere
HEADLESS=false
```

---

## 💻 Kullanım (Usage)

### Bir Test Senaryosu Çalıştırma

İstediğiniz bir YAML senaryosunu doğrudan `tsx` ile çalıştırabilirsiniz:

```powershell
# Dashboard detay testi
npx tsx src/index.ts scenarios/optimus_dashboard_details.yaml

# Bus Policy doğrulama testi
npx tsx src/index.ts scenarios/bus_policy_verification.yaml
```

### Projeyi Derleme (Build)

TypeScript kodlarını derlemek için:

```powershell
npm run build
```

---

## 📝 Senaryo Yazımı (Writing Scenarios)

Senaryolar `scenarios/` klasöründe `.yaml` formatında tanımlanır:

```yaml
Name: Optimus Dashboard Detailed Functional Test
Steps:
  - Go to https://t-operator.gdaoperator.aero/
  - Type 'yusuf.birdal@gozendigital.onmicrosoft.com' into the username input
  - Type '*****' into the password input
  - Click the login button
  - Verify that the page contains the title 'Operational Dashboard'
  - Click on the 'Aircraft Management' button
  - Verify that the 'Aircraft List' submenu is visible
```

### Dinamik Veri Üreticileri (Dynamic Data Generators)
Senaryo adımlarında rastgele dinamik veriler kullanmak için aşağıdaki şablonları kullanabilirsiniz:
- `{{GEN_NAME}}`: Rastgele isim üretir.
- `{{GEN_EMAIL}}`: Rastgele e-posta adresi üretir.
- `{{GEN_PHONE}}`: Rastgele telefon numarası üretir.
- `{{GEN_ROLE}}`: Rastgele unvan üretir.

---

## 📜 Lisans

Bu proje MIT lisansı ile lisanslanmıştır.
