import { chromium, firefox, webkit, Browser, BrowserContext, Page, Locator } from 'playwright';
import { TestSettings } from '../types/index.js';

export class PlaywrightManager {
  private browser: Browser | null = null;
  private currentContext: BrowserContext | null = null;
  private currentPage: Page | null = null;
  private settings: TestSettings;

  constructor(settings?: Partial<TestSettings>) {
    this.settings = {
      headless: process.env.HEADLESS === 'true' || false,
      browserType: (process.env.BROWSER_TYPE as any) || 'chromium',
      slowMo: Number(process.env.SLOW_MO) || 100,
      defaultTimeout: Number(process.env.DEFAULT_TIMEOUT) || 15000,
      baseUrl: process.env.BASE_URL || 'https://t-operator.gdaoperator.aero/',
      ...settings
    };
  }

  public async initBrowser(): Promise<void> {
    if (this.browser) return;

    const launchOptions = {
      headless: this.settings.headless,
      slowMo: this.settings.slowMo
    };

    switch (this.settings.browserType) {
      case 'firefox':
        this.browser = await firefox.launch(launchOptions);
        break;
      case 'webkit':
        this.browser = await webkit.launch(launchOptions);
        break;
      default:
        this.browser = await chromium.launch(launchOptions);
        break;
    }
  }

  public async startNewContext(): Promise<Page> {
    await this.initBrowser();
    if (!this.browser) throw new Error('[PlaywrightManager] Browser failed to initialize.');

    if (this.currentContext) {
      await this.currentContext.close();
    }

    this.currentContext = await this.browser.newContext({
      baseURL: this.settings.baseUrl,
      viewport: { width: 1366, height: 768 },
      ignoreHTTPSErrors: true
    });

    this.currentContext.setDefaultTimeout(this.settings.defaultTimeout);
    this.currentPage = await this.currentContext.newPage();
    return this.currentPage;
  }

  public async closeContext(): Promise<void> {
    if (this.currentContext) {
      await this.currentContext.close();
      this.currentContext = null;
      this.currentPage = null;
    }
  }

  public async closeBrowser(): Promise<void> {
    await this.closeContext();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Smart Locator strategy that supports Playwright semantic locators as well as standard CSS/XPath.
   */
  public findSmartLocator(page: Page, selector: string): Locator {
    const s = selector.trim();

    if (s.includes(',') && !s.startsWith('/') && !s.startsWith('xpath=')) {
      const parts = s.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length > 1) {
        let combined = this.findSingleSmartLocator(page, parts[0]);
        for (let i = 1; i < parts.length; i++) {
          combined = combined.or(this.findSingleSmartLocator(page, parts[i]));
        }
        return combined;
      }
    }

    return this.findSingleSmartLocator(page, s);
  }

  private findSingleSmartLocator(page: Page, selector: string): Locator {
    const s = selector.trim();

    if (s.startsWith('role=')) {
      const match = s.match(/role=([^\s\[]+)(?:\[(name|description)="([^"]+)"\])?/);
      if (match) {
        const role = match[1] as any;
        const val = match[3];
        if (val) {
          // Composite fallback locator: matches by name, description, title, aria-label, and text
          return page.getByRole(role, { name: val })
            .or(page.getByRole(role, { description: val }))
            .or(page.locator(`[title*="${val}" i]`))
            .or(page.locator(`[aria-label*="${val}" i]`))
            .or(page.locator(`button:has-text("${val}")`));
        }
        return page.getByRole(role);
      }
    }

    if (s.startsWith('text=')) {
      const textVal = s.substring(5).replace(/^["']|["']$/g, '');
      return page.getByText(textVal, { exact: false });
    }

    if (s.startsWith('label=')) {
      const labelVal = s.substring(6).replace(/^["']|["']$/g, '');
      return page.getByLabel(labelVal);
    }

    if (s.startsWith('placeholder=')) {
      const phVal = s.substring(12).replace(/^["']|["']$/g, '');
      return page.getByPlaceholder(phVal);
    }

    // Default fallback to standard Playwright locator (CSS/XPath)
    return page.locator(s);
  }

  public async waitForStability(page: Page, isFast: boolean = false): Promise<void> {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: isFast ? 2000 : 5000 });
      await page.waitForLoadState('networkidle', { timeout: isFast ? 2000 : 5000 });
    } catch {
      // Ignore timeout if page has ongoing background requests
    }
  }
}
