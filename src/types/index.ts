export interface Step {
  name?: string;
  action?: string;
  Name?: string;
  Action?: string;
  status?: 'Pending' | 'In Progress' | 'Passed' | 'Failed' | 'Skipped';
  startTime?: Date;
  endTime?: Date;
  durationMs?: number;
  errorMessage?: string;
  screenshotPath?: string;
}

export interface Scenario {
  name?: string;
  Name?: string;
  tags?: string[];
  Tags?: string[];
  steps?: (string | Step)[];
  Steps?: (string | Step)[];
}

export interface PlaywrightAction {
  actionType: 'click' | 'type' | 'select' | 'hover' | 'press' | 'navigate' | 'verify' | 'wait';
  selector?: string;
  value?: string;
  description?: string;
  semanticRole?: string;
  semanticName?: string;
}

export interface CacheEntry {
  action: PlaywrightAction;
  createdAt: string;
  urlPattern: string;
  hitCount: number;
  domSignature?: string;
}

export interface TestSettings {
  headless: boolean;
  browserType: 'chromium' | 'firefox' | 'webkit';
  slowMo: number;
  defaultTimeout: number;
  baseUrl: string;
}
