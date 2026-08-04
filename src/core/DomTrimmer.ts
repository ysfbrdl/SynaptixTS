import { Page } from 'playwright';

export class DomTrimmer {
  /**
   * Extracts clean ARIA snapshot tree from Playwright, falling back to minified HTML if unavailable.
   */
  public static async getCleanDomContext(page: Page): Promise<string> {
    try {
      // Playwright 1.49+ ARIA snapshot - game changer for AI element matching
      const ariaTree = await page.locator('body').ariaSnapshot();
      if (ariaTree && ariaTree.trim().length > 0) {
        return `[ARIA Accessibility Tree Snapshot]\n${ariaTree}`;
      }
    } catch {
      // Fallback to minified HTML if ARIA snapshot is not supported on target element/page
    }

    const html = await page.content();
    return `[Minified HTML DOM]\n${this.minifyHtml(html)}`;
  }

  /**
   * Minifies HTML by removing comments, script/style tags, and excessive whitespace.
   */
  public static minifyHtml(html: string): string {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '<svg></svg>')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim();
  }

  /**
   * Trims DOM or ARIA tree based on stepAction keyword relevance when payload exceeds maxChars.
   */
  public static trimByRelevance(domText: string, stepAction: string, maxChars: number = 25000): string {
    if (!domText || domText.length <= maxChars) {
      return domText;
    }

    // Extract search keywords (words longer than 2 chars or numbers)
    const stopWords = new Set(['click', 'type', 'into', 'input', 'button', 'verify', 'that', 'exists', 'under', 'page', 'popup', 'row', 'column', 'list', 'the', 'and', 'for', 'with']);
    const keywords = stepAction
      .replace(/['"`,.:;!?()]/g, ' ')
      .split(/\s+/)
      .map(w => w.trim().toLowerCase())
      .filter(w => (w.length > 2 || /^\d+$/.test(w)) && !stopWords.has(w));

    if (keywords.length === 0) {
      return domText.slice(0, maxChars);
    }

    const lowerDom = domText.toLowerCase();
    let bestIndex = -1;

    for (const kw of keywords) {
      const idx = lowerDom.indexOf(kw);
      if (idx !== -1) {
        if (bestIndex === -1 || idx < bestIndex) {
          bestIndex = idx;
        }
      }
    }

    if (bestIndex === -1) {
      return domText.slice(0, maxChars);
    }

    // Preserve top header/navigation context (first 2,000 chars) + slice relevant window around match
    const topHeader = domText.slice(0, 2000);
    const startWindow = Math.max(0, bestIndex - 2000);
    const endWindow = Math.min(domText.length, startWindow + (maxChars - 2500));
    const relevantChunk = domText.slice(startWindow, endWindow);

    return `${topHeader}\n... [RELEVANCE-TRIMMED DOM WINDOW (${startWindow}-${endWindow})] ...\n${relevantChunk}`;
  }

  public static normalizeSelector(selector: string): string {
    if (!selector) return selector;
    return selector.trim();
  }
}
