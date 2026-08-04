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

  public static normalizeSelector(selector: string): string {
    if (!selector) return selector;
    return selector.trim();
  }
}
