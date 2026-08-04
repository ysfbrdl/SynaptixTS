import { Page } from 'playwright';
import { faker } from '@faker-js/faker';
import { PlaywrightManager } from './PlaywrightManager.js';
import { BrainService } from './BrainService.js';
import { SmartCache } from './SmartCache.js';
import { DomTrimmer } from './DomTrimmer.js';
import { HtmlReportService } from './HtmlReportService.js';
import { Scenario, Step, PlaywrightAction } from '../types/index.js';

export class TestRunner {
  private playwrightManager: PlaywrightManager;
  private brain: BrainService;
  private cache: SmartCache;
  private reporter: HtmlReportService;
  private actionHistory: string[] = [];
  private scenarioContext: Map<string, string> = new Map();

  constructor(
    pm?: PlaywrightManager,
    brain?: BrainService,
    cache?: SmartCache,
    reporter?: HtmlReportService
  ) {
    this.playwrightManager = pm || new PlaywrightManager();
    this.brain = brain || new BrainService();
    this.cache = cache || new SmartCache();
    this.reporter = reporter || new HtmlReportService();
  }

  public async runScenarioDetails(scenario: Scenario): Promise<{ success: boolean; steps: Step[]; durationMs: number }> {
    const scenarioName = scenario.name || scenario.Name || 'Test Scenario';
    console.log(`\n========================================`);
    console.log(`🚀 Running Scenario: ${scenarioName}`);
    console.log(`========================================\n`);

    this.actionHistory = [];
    this.scenarioContext.clear();
    this.cache.setScenario(scenarioName);

    const page = await this.playwrightManager.startNewContext();
    const executedSteps: Step[] = [];
    let scenarioSuccess = true;

    try {
      await this.playwrightManager.waitForStability(page);

      const stepsList = scenario.steps || scenario.Steps || [];
      let stepIndex = 1;

      for (const stepRaw of stepsList) {
        let stepObj: Step;
        if (typeof stepRaw === 'string') {
          stepObj = { name: stepRaw, action: stepRaw };
        } else {
          stepObj = {
            name: stepRaw.name || stepRaw.Name || stepRaw.action || stepRaw.Action || 'Step',
            action: stepRaw.action || stepRaw.Action || stepRaw.name || stepRaw.Name || ''
          };
        }

        const stepResult = await this.executeStep(page, scenario, stepObj, stepIndex++);
        executedSteps.push(stepResult);

        if (stepResult.status === 'Failed') {
          scenarioSuccess = false;
          break;
        }
      }
    } catch (err: any) {
      console.error(`[FATAL] Scenario execution crashed: ${err.message}`);
      scenarioSuccess = false;
    } finally {
      await this.playwrightManager.closeContext();
      this.cache.saveAll();
    }

    const totalDurationMs = executedSteps.reduce((acc, s) => acc + (s.durationMs || 0), 0);
    return { success: scenarioSuccess, steps: executedSteps, durationMs: totalDurationMs };
  }

  public async runScenario(scenario: Scenario): Promise<boolean> {
    const res = await this.runScenarioDetails(scenario);
    return res.success;
  }

  private async executeStep(page: Page, scenario: Scenario, step: Step, stepIndex: number): Promise<Step> {
    step.status = 'In Progress';
    step.startTime = new Date();
    const actionText = step.action || step.name || '';
    console.log(`▶ Step ${stepIndex}: "${step.name || actionText}"`);

    const rawCheck = actionText.toLowerCase();
    const isOptional = rawCheck.includes('optional') || rawCheck.includes('if closed');
    const maxAttempts = isOptional ? 1 : 3;
    let lastError: string | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.playwrightManager.waitForStability(page, attempt > 0);

        const currentUrl = page.url();
        const cacheKey = this.cache.generateKey(actionText, currentUrl, stepIndex);

        let action: PlaywrightAction | null = null;
        let isFromCache = false;

        const pageTitle = await page.title().catch(() => '');
        const currentDomSignature = `${pageTitle}|${currentUrl}`;

        // Direct Navigation Rule: Strictly match explicit URL navigation commands (e.g. "Go to https://...")
        const urlMatch = actionText.match(/(https?:\/\/[^\s]+)/i);
        if ((rawCheck.startsWith('go to') || rawCheck.startsWith('navigate to') || rawCheck.startsWith('http://') || rawCheck.startsWith('https://')) && urlMatch) {
          action = {
            actionType: 'navigate',
            selector: urlMatch[1],
            value: urlMatch[1],
            description: `Navigate to ${urlMatch[1]}`
          };
          console.log(`   🚀 [DIRECT ACTION] Navigating to ${urlMatch[1]}`);
        } else if (attempt === 0 && !lastError) {
          action = this.cache.get(cacheKey, currentDomSignature);
          if (action) {
            isFromCache = true;
            console.log(`   ⚡ [SMART CACHE HIT] Using cached selector for step`);
          }
        }

        let screenshotBuffer: Buffer | undefined;

        if (!action) {
          console.log(`   🧠 Thinking with Gemini 2.5 (Attempt ${attempt + 1})...`);
          
          try {
            screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 50 });
          } catch {
            // Continue if screenshot fails
          }

          const cleanDomContext = await DomTrimmer.getCleanDomContext(page);

          action = await this.brain.decideAction(
            actionText,
            cleanDomContext,
            this.actionHistory.slice(-5),
            lastError,
            screenshotBuffer
          );
        }

        if (!action) {
          throw new Error(`Failed to resolve action for step "${step.name}"`);
        }

        // If Gemini detected page loading (actionType 'wait') during an active step (type, click, select, verify), wait & re-query Gemini gracefully with fresh DOM AND fresh screenshot
        if (action.actionType.toLowerCase() === 'wait' && ['click', 'type', 'select', 'verify', 'check'].some(k => rawCheck.includes(k))) {
          console.log(`   ⏳ Page loading detected. Waiting 2.5s for UI elements to render...`);
          await page.waitForTimeout(2500);
          try {
            screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 50 });
          } catch {
            screenshotBuffer = undefined;
          }
          const cleanDomContext = await DomTrimmer.getCleanDomContext(page);
          action = await this.brain.decideAction(
            actionText,
            cleanDomContext,
            this.actionHistory.slice(-5),
            lastError,
            screenshotBuffer
          );
        }

        await this.performPlaywrightAction(page, action);

        // Save to cache ONLY AFTER action successfully executes and passes on page
        if (!isFromCache && action && action.selector) {
          this.cache.set(cacheKey, action, currentUrl, actionText, currentDomSignature);
        }

        this.actionHistory.push(`SUCCESS: ${step.name} -> ${action.actionType} on ${action.selector}`);

        step.status = 'Passed';
        step.endTime = new Date();
        step.durationMs = step.endTime.getTime() - step.startTime.getTime();
        console.log(`   ✅ Passed (${step.durationMs}ms)`);
        return step;

      } catch (err: any) {
        lastError = err.message;
        console.warn(`   ⚠️ [ATTEMPT ${attempt + 1} FAILED] ${err.message}`);

        if (attempt < maxAttempts - 1) {
          const cacheKey = this.cache.generateKey(actionText, page.url(), stepIndex);
          this.cache.invalidate(cacheKey);
          console.log(`   🔄 Cache invalidated. Retrying with Gemini...`);
        } else {
          step.status = isOptional ? 'Passed' : 'Failed';
          step.errorMessage = err.message;
          step.endTime = new Date();
          step.durationMs = step.endTime.getTime() - step.startTime.getTime();

          try {
            const ssPath = `./reports/screenshots/fail_step_${stepIndex}_${Date.now()}.png`;
            await page.screenshot({ path: ssPath, fullPage: true });
            step.screenshotPath = ssPath;
          } catch {
            // Ignore screenshot failure
          }

          if (isOptional) {
            console.log(`   ⚠️ Optional step skipped: ${err.message}`);
          } else {
            console.error(`   ❌ Failed: ${err.message}`);
          }
          return step;
        }
      }
    }

    return step;
  }

  private async dismissToastsAndWaitLoaders(page: Page): Promise<void> {
    try {
      // 1. Instantly hide and strip any Toast notification overlays (e.g. "Hi, Welcome Back") from DOM
      await page.addStyleTag({
        content: `
          .p-toast, p-toast, .toast, .ngx-toastr, .notification-overlay, mat-snack-bar {
            display: none !important;
            pointer-events: none !important;
            visibility: hidden !important;
          }
        `
      }).catch(() => {});

      await page.evaluate(() => {
        document.querySelectorAll('.p-toast, p-toast, .toast, .ngx-toastr, .notification-overlay, mat-snack-bar').forEach(el => el.remove());
      }).catch(() => {});

      // 2. Wait for central progress bar (e.g. PrimeNG / Angular dashboard loader) to finish loading
      const loaders = page.locator('.p-progressbar, mat-progress-bar, .spinner-border, .loading-bar, .p-progress-spinner');
      if (await loaders.first().isVisible({ timeout: 400 }).catch(() => false)) {
        await loaders.first().waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
      }
    } catch {
      // Ignore if no toast or progress loader is present
    }
  }

  private async performPlaywrightAction(page: Page, action: PlaywrightAction): Promise<void> {
    const resolvedValue = this.resolveDynamicData(action.value || '');
    const actionType = action.actionType.toLowerCase();

    if (actionType === 'navigate') {
      const targetUrl = resolvedValue || action.selector || '/';
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      return;
    }

    if (!action.selector) {
      throw new Error(`Action type '${actionType}' requires a selector.`);
    }

    const locator = this.playwrightManager.findSmartLocator(page, action.selector);

    // Generalize Toast & Progress Loader Cleanup before ANY element interaction (click, type, verify, hover, select)
    await this.dismissToastsAndWaitLoaders(page);

    switch (actionType) {
      case 'click':

        // Smart Dropdown / Paginator Handler: Strictly triggered only when AI identified a paginator / combobox dropdown action
        const isPaginator =
          action.semanticRole?.toLowerCase().includes('combobox') ||
          action.description?.toLowerCase().includes('paginat') ||
          action.selector?.toLowerCase().includes('paginator') ||
          action.selector?.toLowerCase().includes('p-dropdown') ||
          (action.description?.toLowerCase().includes('items per page') && action.selector?.includes('20'));

        if (isPaginator) {
          const paginatorDropdown = page.locator('.p-paginator p-dropdown, .p-paginator .p-dropdown-label, .p-paginator-rpp-options, p-dropdown, mat-select').first();
          if (await paginatorDropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
            await paginatorDropdown.click({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(500);
            const item20 = page.locator('p-dropdownitem:has-text("20"), [role="option"]:has-text("20"), li:has-text("20"), .p-dropdown-item:has-text("20")').first();
            if (await item20.isVisible({ timeout: 3000 }).catch(() => false)) {
              await item20.click({ timeout: 5000 });
              await page.waitForTimeout(1500);
              break;
            }
          }
        }

        try {
          await locator.first().click({ timeout: 15000 });
        } catch {
          // If click is blocked or obscured by an overlay, force click or dispatch event directly
          await locator.first().click({ force: true, timeout: 8000 });
        }

        // Post-login redirect handler: If clicked a login/signin button, wait for page to redirect away from /login
        if (action.selector.toLowerCase().includes('sign in') || action.selector.toLowerCase().includes('login')) {
          console.log(`   ⏳ Post-login redirect detected. Waiting for URL navigation...`);
          await page.waitForURL(url => !url.pathname.includes('/auth/login') && !url.pathname.includes('/login'), { timeout: 10000 }).catch(() => {});
          await page.waitForLoadState('domcontentloaded').catch(() => {});
        } else {
          await page.waitForTimeout(1500);
        }
        break;

      case 'type':
        await locator.first().fill(resolvedValue, { timeout: 10000 });
        break;

      case 'select':
        await locator.first().selectOption(resolvedValue, { timeout: 10000 });
        break;

      case 'hover':
        await locator.first().hover({ timeout: 5000 });
        break;

      case 'press':
        await locator.first().press(resolvedValue || 'Enter');
        break;

      case 'verify':
        const targetText = resolvedValue || action.description || '';
        if (!action.selector || ['document', 'body', 'title', 'head'].includes(action.selector.toLowerCase())) {
          const startTime = Date.now();
          while (Date.now() - startTime < 8000) {
            const pageTitle = await page.title();
            const pageContent = await page.content();
            if (pageTitle.toLowerCase().includes(targetText.toLowerCase()) || pageContent.toLowerCase().includes(targetText.toLowerCase())) {
              return;
            }
            if (await page.getByText(targetText, { exact: false }).first().isVisible().catch(() => false)) {
              return;
            }
            await page.waitForTimeout(500);
          }
          throw new Error(`Verification failed. Page does not contain text or title '${targetText}'.`);
        } else {
          try {
            // Playwright waitFor({ state: 'visible' }) auto-waits up to 10s for element to hydrate/render
            await locator.first().waitFor({ state: 'visible', timeout: 10000 });
            return;
          } catch {
            if (targetText && (await page.getByText(targetText, { exact: false }).first().isVisible().catch(() => false))) {
              return;
            }
            throw new Error(`Verification failed. Element '${action.selector}' was not visible within 10s.`);
          }
        }
        break;

      case 'wait':
        await page.waitForTimeout(Number(resolvedValue) || 2000);
        break;

      default:
        throw new Error(`Unsupported action type '${actionType}'`);
    }
  }

  private resolveDynamicData(input: string): string {
    if (!input) return input;

    let result = input;

    if (result.includes('{{GEN_NAME}}')) {
      if (!this.scenarioContext.has('GEN_NAME')) {
        this.scenarioContext.set('GEN_NAME', faker.person.fullName());
      }
      result = result.replace(/{{GEN_NAME}}/g, this.scenarioContext.get('GEN_NAME')!);
    }

    if (result.includes('{{GEN_EMAIL}}')) {
      if (!this.scenarioContext.has('GEN_EMAIL')) {
        this.scenarioContext.set('GEN_EMAIL', faker.internet.email());
      }
      result = result.replace(/{{GEN_EMAIL}}/g, this.scenarioContext.get('GEN_EMAIL')!);
    }

    if (result.includes('{{GEN_ROLE}}')) {
      if (!this.scenarioContext.has('GEN_ROLE')) {
        this.scenarioContext.set('GEN_ROLE', faker.person.jobTitle());
      }
      result = result.replace(/{{GEN_ROLE}}/g, this.scenarioContext.get('GEN_ROLE')!);
    }

    if (result.includes('{{GEN_PHONE}}')) {
      if (!this.scenarioContext.has('GEN_PHONE')) {
        this.scenarioContext.set('GEN_PHONE', faker.phone.number());
      }
      result = result.replace(/{{GEN_PHONE}}/g, this.scenarioContext.get('GEN_PHONE')!);
    }

    return result;
  }
}
