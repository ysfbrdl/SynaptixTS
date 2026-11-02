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
      baseUrl: process.env.BASE_URL || 'https://www.saucedemo.com/',
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

  /**
   * Returns the freshest active page in the current context.
   * Handles cases where post-login SSO redirects open new pages or close existing ones.
   */
  public async getActivePage(currentPage: Page): Promise<Page> {
    if (!this.currentContext) return currentPage;

    try {
      // Check if the current page is still alive
      await currentPage.title();
      return currentPage;
    } catch {
      // Current page is stale/closed - find the latest open page in the context
      const pages = this.currentContext.pages();
      if (pages.length > 0) {
        // Use the most recently opened page
        const activePage = pages[pages.length - 1];
        this.currentPage = activePage;
        console.log(`   🔄 [PAGE RECOVERY] Stale page detected. Switched to active page: ${activePage.url()}`);
        // Wait for it to fully load
        await activePage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        return activePage;
      }
    }

    return currentPage;
  }

  /**
   * Checks if the browser, context, or page has been closed or disconnected.
   */
  public isBrowserOrPageClosed(page?: Page | null): boolean {
    if (!this.browser || !this.browser.isConnected()) return true;
    if (!this.currentContext) return true;
    try {
      const pages = this.currentContext.pages();
      if (pages.length === 0) return true;
      if (page && page.isClosed()) {
        return pages.every(p => p.isClosed());
      }
      return false;
    } catch {
      return true;
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
    let s = selector.trim();

    // Auto-fix non-standard Playwright chaining operator '<<' or 'prev=' if AI attempts backward traversal syntax
    if (s.includes('<<')) {
      s = s.split('<<')[0].trim();
    }
    if (s.includes('prev=')) {
      s = s.replace(/prev=[^\s>]+/gi, '').trim();
    }

    // Support locator chaining with '>>'
    if (s.includes('>>')) {
      const parts = s.split('>>').map(p => p.trim()).filter(Boolean);
      if (parts.length > 1) {
        let chained = this.findSingleSmartLocator(page, parts[0]);
        for (let i = 1; i < parts.length; i++) {
          chained = chained.locator(this.findSingleSmartLocator(page, parts[i]));
        }
        return chained;
      }
    }

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
    let s = selector.trim();

    // Auto-fix ARIA role selectors generated without 'role=' prefix (e.g. 'textbox[name="Role Name*"]')
    const roleWithoutPrefixMatch = s.match(/^(textbox|button|combobox|dialog|option|checkbox|heading|tab|region|switch|menuitem|link|list|row|cell)\[(name|description)[\*\~\^\$]?="([^"]+)"\]/i);
    if (roleWithoutPrefixMatch) {
      s = `role=${s}`;
    }

    if (s.startsWith('role=')) {
      const match = s.match(/role=([^\s\[]+)(?:\[(name|description)[\*\~\^\$]?="([^"]+)"(?:\s+[iI])?\])?/);
      if (match) {
        const role = match[1] as any;
        const val = match[3];

        if (!val) {
          // No name qualifier: just use getByRole (no broad fallbacks, let Playwright pick)
          return page.getByRole(role);
        }

        const cleanVal = val.replace(/\*$/, '').trim();

        // --- ROW: table row matching ---
        if (role === 'row') {
          return page.getByRole('row', { name: cleanVal })
            .or(page.locator(`.p-datatable-tbody > tr:has-text("${cleanVal}")`))
            .or(page.locator(`tr:has-text("${cleanVal}")`));
        }

        // --- SWITCH / CHECKBOX: toggle matching ---
        if (role === 'switch' || role === 'checkbox') {
          // 1. Card / Item Scoped Match: Target individual permission card/row (.rounded-xl, .border-gray-200, tr, li, .permission-item) containing cleanVal
          const cardScopedSwitch = page.locator('.rounded-xl, .border-gray-200, tr, li, .permission-item, .p-field-checkbox')
            .filter({ has: page.locator(`div:has-text("${cleanVal}"), span:has-text("${cleanVal}"), label:has-text("${cleanVal}")`) })
            .locator('button[role="switch"], [role="switch"], input[type="checkbox"], p-inputswitch, p-toggleswitch');

          // 2. Direct ARIA / Label match
          const directMatch = page.getByRole(role, { name: cleanVal })
            .or(page.getByRole(role, { name: val }))
            .or(page.getByLabel(cleanVal));

          return cardScopedSwitch.or(directMatch);
        }

        // --- BUTTON: prioritize actual <button> elements, never generic text containers ---
        if (role === 'button') {
          return page.getByRole('button', { name: cleanVal })
            .or(page.getByRole('button', { name: val }))
            .or(page.locator(`button:has-text("${cleanVal}")`))
            .or(page.locator(`input[type="submit"][value="${cleanVal}" i]`))
            .or(page.locator(`input[type="button"][value="${cleanVal}" i]`))
            .or(page.locator(`[data-test*="${cleanVal.toLowerCase().replace(/\s+/g, '-')}" i]`))
            .or(page.locator(`[role="button"]:has-text("${cleanVal}")`))
            .or(page.locator(`[aria-label="${cleanVal}" i]`))
            .or(page.locator(`[title="${cleanVal}" i]`));
        }

        // --- TEXTBOX / INPUT: prioritize actual input elements ---
        if (role === 'textbox' || role === 'combobox') {
          return page.getByRole(role, { name: cleanVal })
            .or(page.getByRole(role, { name: val }))
            .or(page.getByLabel(cleanVal))
            .or(page.getByLabel(val))
            .or(page.getByPlaceholder(cleanVal))
            .or(page.getByPlaceholder(val))
            .or(page.locator(`[data-test*="${cleanVal.toLowerCase().replace(/\s+/g, '')}" i]`))
            .or(page.locator(`[data-test*="${cleanVal.toLowerCase().replace(/\s+/g, '-')}" i]`))
            .or(page.locator(`input[name*="${cleanVal}" i], textarea[name*="${cleanVal}" i]`))
            .or(page.locator(`input[id*="${cleanVal}" i], textarea[id*="${cleanVal}" i]`))
            .or(page.locator(`input[aria-label*="${cleanVal}" i]`))
            .or(page.locator(`input[placeholder*="${cleanVal}" i]`));
        }

        // --- MENUITEM: strict menu/context menu matching ---
        if (role === 'menuitem') {
          return page.getByRole('menuitem', { name: cleanVal })
            .or(page.locator(`.p-menuitem-link:has-text("${cleanVal}")`))
            .or(page.locator(`[role="menuitem"]:has-text("${cleanVal}")`));
        }

        // --- LINK ---
        if (role === 'link') {
          return page.getByRole('link', { name: cleanVal })
            .or(page.locator(`a:has-text("${cleanVal}")`));
        }

        // --- GENERIC ROLE FALLBACK (no broad span/a fallbacks) ---
        return page.getByRole(role, { name: cleanVal })
          .or(page.getByRole(role, { name: val }))
          .or(page.getByRole(role, { description: cleanVal }))
          .or(page.getByLabel(cleanVal))
          .or(page.locator(`[aria-label*="${cleanVal}" i]`));
      }
    }

    if (s.startsWith('text=')) {
      const textVal = s.substring(5).replace(/^['"]/,'').replace(/['"]$/,'');
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

    if (s.startsWith('data-test=')) {
      const dtVal = s.substring(10).replace(/^["']|["']$/g, '');
      return page.locator(`[data-test="${dtVal}"]`);
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
