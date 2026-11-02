import { Page } from 'playwright';
import { HeuristicResolver } from './HeuristicResolver.js';
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

    let page = await this.playwrightManager.startNewContext();
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
        } else if (stepRaw && typeof stepRaw === 'object' && !stepRaw.name && !stepRaw.Name && !stepRaw.action && !stepRaw.Action) {
          const entries = Object.entries(stepRaw);
          const fullText = entries.length > 0 ? `${entries[0][0]}: ${entries[0][1]}` : 'Step';
          stepObj = { name: fullText, action: fullText };
        } else {
          stepObj = {
            name: stepRaw.name || stepRaw.Name || stepRaw.action || stepRaw.Action || 'Step',
            action: stepRaw.action || stepRaw.Action || stepRaw.name || stepRaw.Name || ''
          };
        }

        // Always resolve the freshest active page before each step (handles SSO/redirects that open new pages)
        page = await this.playwrightManager.getActivePage(page);

        if (this.playwrightManager.isBrowserOrPageClosed(page)) {
          console.error(`\n🛑 [ABORT] Browser window or page was closed. Halting remaining scenario execution.`);
          scenarioSuccess = false;
          break;
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
          } else {
            const heuristicAction = HeuristicResolver.resolve(actionText);
            if (heuristicAction) {
              action = heuristicAction;
              console.log(`   ⚡ [LOCAL HEURISTIC MATCH] Resolved step intent locally without AI`);
            }
          }
        }

        let screenshotBuffer: Buffer | undefined;

        if (!action) {
          if (this.playwrightManager.isBrowserOrPageClosed(page)) {
            throw new Error('Target page, context or browser has been closed.');
          }

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

        if (action) {
          if (rawCheck.includes('random role') && action.actionType.toLowerCase() === 'type') {
            action.value = '{{GEN_ROLE}}';
          } else if ((rawCheck.includes('random name') || rawCheck.includes('random username')) && action.actionType.toLowerCase() === 'type') {
            action.value = '{{GEN_NAME}}';
          } else if (rawCheck.includes('random email') && action.actionType.toLowerCase() === 'type') {
            action.value = '{{GEN_EMAIL}}';
          } else if (rawCheck.includes('random first name') && action.actionType.toLowerCase() === 'type') {
            action.value = '{{GEN_FIRST_NAME}}';
          } else if (rawCheck.includes('random last name') && action.actionType.toLowerCase() === 'type') {
            action.value = '{{GEN_LAST_NAME}}';
          } else if ((rawCheck.includes('random zip') || rawCheck.includes('random postal code')) && action.actionType.toLowerCase() === 'type') {
            action.value = '{{GEN_ZIP}}';
          }
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

        if (err.message?.includes('QuotaExhaustedError')) {
          console.error(`   🛑 [QUOTA EXHAUSTED] All Gemini API keys are rate limited (429). Halting step retries.`);
          step.status = 'Failed';
          step.errorMessage = err.message;
          step.endTime = new Date();
          step.durationMs = step.endTime.getTime() - step.startTime.getTime();
          return step;
        }

        const isClosedError =
          err.message?.includes('closed') ||
          err.message?.includes('Target page') ||
          err.message?.includes('context') ||
          this.playwrightManager.isBrowserOrPageClosed(page);

        if (isClosedError) {
          console.error(`   🛑 [ABORT STEP] Target browser page was closed. Halting step retries and AI calls.`);
          step.status = 'Failed';
          step.errorMessage = `Browser or page closed: ${err.message}`;
          step.endTime = new Date();
          step.durationMs = step.endTime.getTime() - step.startTime.getTime();
          return step;
        }

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
    const resolvedSelector = this.resolveDynamicData(action.selector || '');
    const resolvedValue = this.resolveDynamicData(action.value || '');
    const actionType = action.actionType.toLowerCase();

    if (actionType === 'navigate') {
      const targetUrl = resolvedValue || resolvedSelector || '/';
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      return;
    }

    if (!resolvedSelector) {
      throw new Error(`Action type '${actionType}' requires a selector.`);
    }

    const locator = this.playwrightManager.findSmartLocator(page, resolvedSelector);

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
            const isNavAction =
              action.semanticName?.toLowerCase().match(/^(checkout|continue|finish|back|shopping cart|cart)$/) ||
              action.description?.toLowerCase().includes('checkout') ||
              action.description?.toLowerCase().includes('continue') ||
              action.description?.toLowerCase().includes('cart') ||
              action.description?.toLowerCase().includes('finish');
            if (isNavAction) {
              await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
              await page.waitForTimeout(800);
            } else {
              await page.waitForTimeout(400);
            }
            const item20 = page.locator('p-dropdownitem:has-text("20"), [role="option"]:has-text("20"), li:has-text("20"), .p-dropdown-item:has-text("20")').first();
            if (await item20.isVisible({ timeout: 3000 }).catch(() => false)) {
              await item20.click({ timeout: 5000 });
              await page.waitForTimeout(1500);
              break;
            }
          }
        }

        // Smart Context Menu Handler: Re-open row ellipsis menu if popup menu closed before clicking action (e.g. 'Detail', 'Delete', 'Edit')
        const isMenuItemClick = action.selector?.toLowerCase().includes('detail') || action.selector?.toLowerCase().includes('delete') || action.selector?.toLowerCase().includes('edit') || action.semanticRole === 'menuitem';
        if (isMenuItemClick) {
          const menuOpen = await page.locator('.p-tieredmenu, .p-menu, .p-contextmenu, [role="menu"]').first().isVisible({ timeout: 500 }).catch(() => false);
          if (!menuOpen) {
            const currentRole = this.scenarioContext.get('GEN_ROLE');
            if (currentRole) {
              const ellipsisBtn = this.playwrightManager.findSmartLocator(page, `role=row[name*="${currentRole}"] >> button`);
              if (await ellipsisBtn.first().isVisible({ timeout: 1500 }).catch(() => false)) {
                await ellipsisBtn.first().click({ force: true }).catch(() => {});
                await page.waitForTimeout(600);
              }
            }
          }
        }

        const isSwitchClick =
          action.semanticRole === 'switch' ||
          action.selector?.toLowerCase().includes('switch') ||
          action.description?.toLowerCase().includes('switch');

        if (isSwitchClick) {
          await locator.first().click({ force: true, timeout: 15000 });
          await page.waitForTimeout(500);
        } else {
          await locator.first().click({ timeout: 15000 });
        }

        // Post-Detail Click Handler: Wait for async Role Details modal API data hydration
        if (isMenuItemClick && (resolvedSelector.toLowerCase().includes('detail') || action.description?.toLowerCase().includes('detail'))) {
          console.log(`   ⏳ Role Details modal opened. Waiting for async selection summary hydration...`);
          await page.waitForTimeout(2500);
        }

        // Post-login redirect handler: If clicked a login/signin button, wait for full auth redirect chain to complete
        const isLoginClick =
          resolvedSelector.toLowerCase().includes('sign in') ||
          resolvedSelector.toLowerCase().includes('login') ||
          action.description?.toLowerCase().includes('sign in') ||
          action.description?.toLowerCase().includes('log in') ||
          action.semanticName?.toLowerCase().includes('sign in');

        if (isLoginClick) {
          console.log(`   ⏳ Post-login redirect detected. Waiting for URL navigation...`);
          // Wait for redirect away from login page (up to 20s for SSO chains)
          await page.waitForURL(
            url => url.pathname.includes('/inventory.html') || (!url.pathname.includes('/auth/login') && !url.pathname.includes('/login') && url.pathname !== '/' && url.pathname !== ''),
            { timeout: 20000 }
          ).catch(() => {});
          // Wait for full page load including SSO redirects (networkidle = no requests for 500ms)
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(600);
        } else {
          // Post-save/submit: if a modal/dialog was open, wait for it to close
          const isSaveOrSubmit =
            action.semanticName?.toLowerCase().match(/^(save|submit|confirm|create|add|update|ok|yes)$/) ||
            action.description?.toLowerCase().includes('save') ||
            action.description?.toLowerCase().includes('submit');

          if (isSaveOrSubmit) {
            // Wait for any open dialog/modal to disappear (up to 5s)
            const dialog = page.locator('[role="dialog"], .p-dialog, .p-sidebar, mat-dialog-container, .modal.show');
            const dialogVisible = await dialog.first().isVisible({ timeout: 800 }).catch(() => false);
            if (dialogVisible) {
              console.log(`   ⏳ Waiting for dialog to close after save...`);
              await dialog.first().waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
            }
            // Also wait for network to settle after save (API call)
            await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
          } else {
            const isNavAction =
              action.semanticName?.toLowerCase().match(/^(checkout|continue|finish|back|shopping cart|cart)$/) ||
              action.description?.toLowerCase().includes('checkout') ||
              action.description?.toLowerCase().includes('continue') ||
              action.description?.toLowerCase().includes('cart') ||
              action.description?.toLowerCase().includes('finish');
            if (isNavAction) {
              await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
              await page.waitForTimeout(800);
            } else {
              await page.waitForTimeout(400);
            }
          }
        }
        break;

      case 'type':
        // Ensure the element is visible and editable before attempting fill
        await locator.first().waitFor({ state: 'visible', timeout: 10000 });
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
        const descLower = (action.description || '').toLowerCase();
        const isAbsenceCheck =
          descLower.includes('delete') ||
          descLower.includes('not appear') ||
          descLower.includes('no longer') ||
          descLower.includes('removed') ||
          descLower.includes('not present') ||
          descLower.includes('disappear') ||
          descLower.includes('absent');

        if (isAbsenceCheck && targetText) {
          // Verify that the element/text is NOT visible on the page (deletion confirmation)
          await page.waitForTimeout(1500); // Give Angular/PrimeNG table time to re-render
          const isStillVisible = await page.getByText(targetText, { exact: false }).first()
            .isVisible({ timeout: 2000 })
            .catch(() => false);

          if (!isStillVisible) {
            console.log(`   ✅ [VERIFY ABSENCE] Verified that '${targetText}' is successfully deleted/absent from page.`);
            return;
          }

          // Double check after 2s for slow network/table refresh
          await page.waitForTimeout(2000);
          const visibleAfterWait = await page.getByText(targetText, { exact: false }).first()
            .isVisible({ timeout: 1000 })
            .catch(() => false);

          if (!visibleAfterWait) {
            console.log(`   ✅ [VERIFY ABSENCE] Verified that '${targetText}' is successfully deleted/absent from page.`);
            return;
          }

          throw new Error(`Verification failed. Text '${targetText}' is still present on the page after deletion.`);
        }

        if (!action.selector || ['document', 'body', 'title', 'head'].includes(action.selector.toLowerCase())) {
          // Wait 1.5s for async dialog/drawer hydration (e.g. Selection Summary populating via API)
          await page.waitForTimeout(1500);

          // Build permission code variants (e.g. Action_UserCreate -> ['Action_UserCreate', 'UserCreate', 'User Create'])
          const searchVariants: string[] = [targetText];
          if (targetText.startsWith('Action_')) {
            const stripped = targetText.replace(/^Action_/, '');
            searchVariants.push(stripped); // 'UserCreate'
            searchVariants.push(stripped.replace(/([a-z])([A-Z])/g, '$1 $2')); // 'User Create'
          }

          for (const variant of searchVariants) {
            const isVisibleText = await page.getByText(variant, { exact: false }).first()
              .waitFor({ state: 'visible', timeout: 6000 })
              .then(() => true)
              .catch(() => false);
            if (isVisibleText) {
              console.log(`   ✅ [VERIFY MATCH] Verified visible right '${variant}' for step '${targetText}'.`);
              return;
            }

            let pageContent = await page.content().catch(() => '');
            if (pageContent.toLowerCase().includes(variant.toLowerCase())) {
              console.log(`   ✅ [VERIFY MATCH] Found right '${variant}' in DOM for step '${targetText}'.`);
              return;
            }
          }

          // Retry once more after 2s for slow API responses
          await page.waitForTimeout(2000);
          let retryContent = await page.content().catch(() => '');
          for (const variant of searchVariants) {
            if (retryContent.toLowerCase().includes(variant.toLowerCase())) {
              console.log(`   ✅ [VERIFY MATCH RETRY] Found right '${variant}' in DOM for step '${targetText}'.`);
              return;
            }
          }

          throw new Error(`Verification failed. Page does not contain visible text matching '${targetText}' (checked variants: ${searchVariants.join(', ')}).`);
        } else {
          try {
            // Specific element selector branch: Auto-waits up to 10s for element to hydrate & become visible
            await locator.first().waitFor({ state: 'visible', timeout: 10000 });
            return;
          } catch {
            if (targetText) {
              const isVisibleText = await page.getByText(targetText, { exact: false }).first()
                .waitFor({ state: 'visible', timeout: 6000 })
                .then(() => true)
                .catch(() => false);
              if (isVisibleText) return;
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

    if (result.includes('{{GEN_FIRST_NAME}}')) {
      if (!this.scenarioContext.has('GEN_FIRST_NAME')) {
        this.scenarioContext.set('GEN_FIRST_NAME', faker.person.firstName());
      }
      result = result.replace(/{{GEN_FIRST_NAME}}/g, this.scenarioContext.get('GEN_FIRST_NAME')!);
    }

    if (result.includes('{{GEN_LAST_NAME}}')) {
      if (!this.scenarioContext.has('GEN_LAST_NAME')) {
        this.scenarioContext.set('GEN_LAST_NAME', faker.person.lastName());
      }
      result = result.replace(/{{GEN_LAST_NAME}}/g, this.scenarioContext.get('GEN_LAST_NAME')!);
    }

    if (result.includes('{{GEN_ZIP}}')) {
      if (!this.scenarioContext.has('GEN_ZIP')) {
        this.scenarioContext.set('GEN_ZIP', faker.location.zipCode());
      }
      result = result.replace(/{{GEN_ZIP}}/g, this.scenarioContext.get('GEN_ZIP')!);
    }

    return result;
  }
}
