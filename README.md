# 💎 SynaptixTS — AI-Native E2E Test Automation Framework

**SynaptixTS** is a next-generation E2E test automation framework combining **Playwright** and **Google Gemini** to execute natural language YAML test scenarios with zero maintenance overhead.

This project is fully configured and optimized to run end-to-end tests against the [SauceDemo (Swag Labs)](https://www.saucedemo.com/) e-commerce web application.

---

## 🌟 Key Features

- 🧠 **Natural Language Scenarios (YAML):** Write readable, intent-based test scenarios in plain English without writing test automation boilerplate.
- ⚡ **Zero-API Local Heuristic Engine:** Common web interactions (login, cart actions, checkout forms, sorting, burger menu) resolve deterministically in **<5ms** with zero LLM API cost.
- 🎯 **Smart Locator Engine (`data-test` Aware):** Prioritizes reliable identifiers such as `data-test` attributes, semantic ARIA roles, and standard inputs with built-in composite fallback matching.
- 🔄 **Self-Healing via Gemini:** When a UI structure updates or an unmapped element appears, the framework captures the live DOM and screenshot, prompting Gemini to resolve the optimal locator and keep the build green.
- ⚡ **Layered Smart Cache:**
  - `shared_cache.json`: Stores common reusable steps across all scenarios (e.g., login flows).
  - `.cache/scenarios/${scenario_name}.json`: Caches scenario-specific locator resolutions.
  - Cached steps execute in **~50ms** on subsequent runs without touching external APIs.
- 📊 **Rich Single-File HTML Reporting:** Generates a unified, interactive HTML report containing step statuses, execution durations, pass/fail metrics, and step failure screenshots.

---

## 🤖 Supported AI Models

SynaptixTS uses a resilient fallback chain powered by Google Gemini:

1. **Primary Model: `gemini-3.8-flash`** (High speed, multimodal DOM + screenshot analysis, generous rate limits)
2. **Fallback Model: `gemini-3.1-pro-preview`** (Advanced reasoning for intricate DOM trees and complex UI states)
3. **Legacy Fallbacks: `gemini-2.5-flash`, `gemini-2.5-pro`**

---

## 📁 Project Architecture

```text
SynaptixTS/
├── .cache/                     # Smart cache directory
│   ├── shared_cache.json       # Common authentication/navigation cache
│   └── scenarios/              # Scenario-specific step caches (.json)
├── reports/                    # HTML reports & failure screenshots
│   └── screenshots/            # Automated full-page error captures
├── scenarios/                  # Natural language YAML test suites
│   ├── 01_login_success.yaml
│   ├── 02_login_locked_out.yaml
│   ├── 03_product_sorting.yaml
│   ├── 04_cart_operations.yaml
│   ├── 05_checkout_e2e.yaml
│   └── 06_saucedemo_smoke.yaml
├── src/
│   ├── core/
│   │   ├── BrainService.ts     # Gemini API integration & key rotation
│   │   ├── DomTrimmer.ts       # DOM simplification & ARIA tree snapshotting
│   │   ├── HeuristicResolver.ts# Sub-millisecond deterministic intent matcher
│   │   ├── HtmlReportService.ts# Unified HTML report generator
│   │   ├── PlaywrightManager.ts# Browser context & smart locator engine
│   │   ├── SmartCache.ts       # Multi-layer hybrid cache manager
│   │   └── TestRunner.ts       # Step execution, self-healing & dynamic data engine
│   ├── types/                  # TypeScript interface definitions
│   └── index.ts                # Command-line interface entry point
├── .env.example                # Sample environment variables
├── .env                        # Local API keys and configurations
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🚀 Getting Started

### 1. Install Dependencies

```powershell
npm install
```

### 2. Configure Environment (`.env`)

Create a `.env` file in the project root (you can copy `.env.example`):

```env
# Google Gemini API Key(s) (supports comma-separated rotation keys)
GEMINI_API_KEY=AIzaSyYourGeminiApiKeyHere

# Environment Configuration
BASE_URL=https://www.saucedemo.com/
HEADLESS=false
BROWSER_TYPE=chromium
SLOW_MO=100
DEFAULT_TIMEOUT=15000
```

> **Tip:** You can obtain a free API key in 30 seconds at [Google AI Studio](https://aistudio.google.com/).

---

## 💻 Running Tests

### Standard NPM Commands

```powershell
# Run default login test
npm test

# Run all scenarios in scenarios/
npm run test:all

# Run all scenarios tagged with @smoke
npm run test:smoke
```

### Running by Tag

You can filter and run scenarios using any custom tag in two ways:

#### Option A: Using NPM Script
```powershell
npm run test:tag -- checkout
npm run test:tag -- login
npm run test:tag -- negative
npm run test:tag -- cart
```

#### Option B: Direct CLI Execution (Fastest)
```powershell
npx tsx src/index.ts checkout
npx tsx src/index.ts negative
npx tsx src/index.ts scenarios/05_checkout_e2e.yaml
```

### Building the Project

Compile TypeScript into JavaScript:

```powershell
npm run build
```

---

## 📝 Writing Test Scenarios

Scenarios are defined under the `scenarios/` directory in standard YAML format:

```yaml
name: SauceDemo - Complete E2E Checkout Test
description: Verify end-to-end shopping flow from product selection to order completion
tags:
  - smoke
  - checkout
steps:
  - Go to https://www.saucedemo.com/
  - Type 'standard_user' into the username input
  - Type 'secret_sauce' into the password input
  - Click the login button
  - Click 'Add to cart' button for 'Sauce Labs Backpack'
  - Click the shopping cart icon
  - Click the 'Checkout' button
  - "Verify that 'Checkout: Your Information' is visible"
  - Type a random first name into the first name input
  - Type a random last name into the last name input
  - Type a random zip into the postal code input
  - Click the 'Continue' button
  - "Verify that 'Checkout: Overview' is visible"
  - Verify that 'Payment Information' is visible
  - Click the 'Finish' button
  - Verify that 'Thank you for your order!' is visible
  - Click the 'Back Home' button
  - Verify that 'Products' is visible
```

### Dynamic Data Placeholders (Faker.js)

You can generate randomized test data dynamically within any step text:
- `{{GEN_FIRST_NAME}}`: Generates a random first name.
- `{{GEN_LAST_NAME}}`: Generates a random last name.
- `{{GEN_ZIP}}`: Generates a random postal/zip code.
- `{{GEN_NAME}}`: Generates a random full name.
- `{{GEN_EMAIL}}`: Generates a random valid email address.
- `{{GEN_PHONE}}`: Generates a random phone number.

---

## 👥 SauceDemo Test Accounts

SauceDemo provides pre-configured testing accounts with password `secret_sauce`:

| Username | Purpose |
| :--- | :--- |
| `standard_user` | Regular user for standard end-to-end functional flows |
| `locked_out_user` | Account for validating error handling and negative login assertions |
| `problem_user` | User experiencing specific UI anomalies and image issues |
| `performance_glitch_user` | User with simulated backend latency |
| `error_user` | User encountering checkout errors |
| `visual_user` | User with visual layout variations |

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).
