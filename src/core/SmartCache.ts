import fs from 'fs';
import path from 'path';
import { CacheEntry, PlaywrightAction } from '../types/index.js';

export class SmartCache {
  private sharedCacheMap: Map<string, CacheEntry> = new Map();
  private scenarioCacheMap: Map<string, CacheEntry> = new Map();
  
  private sharedCacheFilePath: string;
  private scenarioCacheFilePath: string | null = null;
  private scenariosDir: string;

  constructor(cacheDirPath: string = './.cache') {
    if (!fs.existsSync(cacheDirPath)) {
      fs.mkdirSync(cacheDirPath, { recursive: true });
    }
    
    this.scenariosDir = path.join(cacheDirPath, 'scenarios');
    if (!fs.existsSync(this.scenariosDir)) {
      fs.mkdirSync(this.scenariosDir, { recursive: true });
    }

    this.sharedCacheFilePath = path.join(cacheDirPath, 'shared_cache.json');
    this.loadSharedCache();
  }

  /**
   * Sets current active scenario for scenario-scoped caching.
   */
  public setScenario(scenarioName: string): void {
    const sanitized = scenarioName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    this.scenarioCacheFilePath = path.join(this.scenariosDir, `${sanitized}.json`);
    this.scenarioCacheMap.clear();
    this.loadScenarioCache();
  }

  public generateKey(stepAction: string, url: string, stepIndex: number): string {
    const normalizedUrl = this.normalizeUrl(url);
    const sanitizedAction = stepAction.trim().toLowerCase();
    return `${stepIndex}_${normalizedUrl}_${sanitizedAction}`;
  }

  public normalizeUrl(rawUrl: string): string {
    try {
      const urlObj = new URL(rawUrl);
      let pathname = urlObj.pathname;
      pathname = pathname
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':guid')
        .replace(/\/\d+/g, '/:id');
      return `${urlObj.host}${pathname}`;
    } catch {
      return rawUrl;
    }
  }

  public get(key: string, currentDomSignature?: string): PlaywrightAction | null {
    let entry = this.sharedCacheMap.get(key) || this.scenarioCacheMap.get(key);

    if (!entry) {
      // Fallback 1: match by action text (URL-agnostic substring search)
      const parts = key.split('_');
      const stepPrefix = parts[0]; // e.g. "16"
      const actionPart = parts.slice(2).join('_'); // everything after stepIndex_urlPart
      if (actionPart) {
        for (const [k, v] of this.sharedCacheMap.entries()) {
          if (k.toLowerCase().includes(actionPart)) { entry = v; break; }
        }
        if (!entry) {
          for (const [k, v] of this.scenarioCacheMap.entries()) {
            if (k.toLowerCase().includes(actionPart)) { entry = v; break; }
          }
        }
      }

      // Fallback 2: match by step index prefix + action text (handles URL changes after navigation)
      if (!entry && stepPrefix && actionPart) {
        const stepAndAction = `${stepPrefix}_`;
        const actionLower = actionPart.toLowerCase();
        for (const [k, v] of this.scenarioCacheMap.entries()) {
          if (k.startsWith(stepAndAction) && k.toLowerCase().endsWith(actionLower)) {
            entry = v; break;
          }
        }
        if (!entry) {
          for (const [k, v] of this.sharedCacheMap.entries()) {
            if (k.startsWith(stepAndAction) && k.toLowerCase().endsWith(actionLower)) {
              entry = v; break;
            }
          }
        }
      }
    }

    if (entry) {
      if (currentDomSignature && entry.domSignature) {
        if (!this.isSignatureMatching(entry.domSignature, currentDomSignature)) {
          console.log(`   ⚠️ [CACHE SIGNATURE MISMATCH] Page structure changed. Bypassing cache to trigger AI Self-Healing...`);
          return null;
        }
      }
      entry.hitCount++;
      return entry.action;
    }

    return null;
  }

  private isSignatureMatching(savedSig: string, currentSig: string): boolean {
    if (savedSig === currentSig) return true;
    const savedParts = savedSig.toLowerCase().split('|').filter(Boolean);
    const currentParts = currentSig.toLowerCase().split('|').filter(Boolean);
    if (savedParts.length === 0) return true;
    let matchCount = 0;
    for (const part of savedParts) {
      if (currentParts.includes(part)) matchCount++;
    }
    const ratio = matchCount / savedParts.length;
    return ratio >= 0.5;
  }

  /**
   * Hybrid Set: Categorizes step into shared_cache or scenario_cache based on action and URL.
   */
  public set(key: string, action: PlaywrightAction, rawUrl: string, stepAction: string, domSignature?: string): void {
    const entry: CacheEntry = {
      action,
      createdAt: new Date().toISOString(),
      urlPattern: this.normalizeUrl(rawUrl),
      hitCount: 1,
      domSignature
    };

    if (this.isSharedStep(stepAction, rawUrl)) {
      this.sharedCacheMap.set(key, entry);
      this.saveSharedCache();
    } else {
      this.scenarioCacheMap.set(key, entry);
      this.saveScenarioCache();
    }
  }

  public invalidate(key: string): void {
    let touched = false;
    if (this.sharedCacheMap.has(key)) {
      this.sharedCacheMap.delete(key);
      this.saveSharedCache();
      touched = true;
    }
    if (this.scenarioCacheMap.has(key)) {
      this.scenarioCacheMap.delete(key);
      this.saveScenarioCache();
      touched = true;
    }
  }

  /**
   * Determines if a step is a common/global step (login, auth, home navigation, etc.)
   */
  private isSharedStep(stepAction: string, rawUrl: string): boolean {
    const actionLower = stepAction.toLowerCase();
    const sharedKeywords = [
      'login', 'log in', 'signin', 'sign in', 'logout', 'log out', 'signout',
      'authenticate', 'username input', 'password input',
      'go to', 'navigate', 'open', 'http://', 'https://'
    ];
    return sharedKeywords.some((kw) => actionLower.includes(kw));
  }

  private loadSharedCache(): void {
    if (fs.existsSync(this.sharedCacheFilePath)) {
      try {
        const rawData = fs.readFileSync(this.sharedCacheFilePath, 'utf-8').trim();
        if (rawData) {
          const jsonObj = JSON.parse(rawData);
          for (const [k, v] of Object.entries(jsonObj)) {
            this.sharedCacheMap.set(k, v as CacheEntry);
          }
        }
      } catch (err) {
        console.warn(`[SmartCache] Failed to load shared cache: ${err}`);
      }
    }
  }

  private loadScenarioCache(): void {
    if (this.scenarioCacheFilePath && fs.existsSync(this.scenarioCacheFilePath)) {
      try {
        const rawData = fs.readFileSync(this.scenarioCacheFilePath, 'utf-8').trim();
        if (rawData) {
          const jsonObj = JSON.parse(rawData);
          for (const [k, v] of Object.entries(jsonObj)) {
            this.scenarioCacheMap.set(k, v as CacheEntry);
          }
        }
      } catch (err) {
        console.warn(`[SmartCache] Failed to load scenario cache: ${err}`);
      }
    }
  }

  public saveSharedCache(): void {
    try {
      const obj: Record<string, CacheEntry> = {};
      this.sharedCacheMap.forEach((val, key) => {
        obj[key] = val;
      });
      fs.writeFileSync(this.sharedCacheFilePath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[SmartCache] Failed to save shared cache: ${err}`);
    }
  }

  public saveScenarioCache(): void {
    if (!this.scenarioCacheFilePath) return;
    try {
      const obj: Record<string, CacheEntry> = {};
      this.scenarioCacheMap.forEach((val, key) => {
        obj[key] = val;
      });
      fs.writeFileSync(this.scenarioCacheFilePath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[SmartCache] Failed to save scenario cache: ${err}`);
    }
  }

  public saveAll(): void {
    this.saveSharedCache();
    this.saveScenarioCache();
  }
}
