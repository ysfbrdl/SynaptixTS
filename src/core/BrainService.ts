import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { PlaywrightAction } from '../types/index.js';
import { DomTrimmer } from './DomTrimmer.js';

export class BrainService {
  private apiKeys: string[] = [];
  private currentKeyIndex: number = 0;
  private fallbackModels: string[] = ['gemini-2.5-flash', 'gemini-2.5-pro'];

  constructor(apiKey?: string) {
    const rawKeys = apiKey || process.env.GEMINI_API_KEY;
    if (!rawKeys) {
      throw new Error('[BrainService] Google Gemini API Key is missing. Set GEMINI_API_KEY in .env file.');
    }
    this.apiKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);
  }

  private getGenAI(): GoogleGenerativeAI {
    const key = this.apiKeys[this.currentKeyIndex % this.apiKeys.length];
    return new GoogleGenerativeAI(key);
  }

  private rotateKey(): void {
    if (this.apiKeys.length > 1) {
      this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
      console.log(`   🔄 Rotated to next Gemini API key (Index ${this.currentKeyIndex})`);
    }
  }

  private systemPrompt = `
You are an expert Playwright Web Test Automation Agent.
Given a user step instruction, current web page DOM (minified/aria snapshot), recent action history, and optional page screenshot:
Your task is to resolve the exact Playwright action required to perform the step.

Rules:
1. Selectors:
   - For "type" actions: ALWAYS target the actual <input> or <textarea> element. For username/email inputs use 'input[type="email"], input[name*="email"], input[name*="user"], input[type="text"]'. For password inputs ALWAYS use 'input[type="password"], input[name*="pass"]'. NEVER use generic 'role=textbox >> nth=X' or index-based matchers.
   - For "click" actions: Inspect full ARIA accessibility tree and HTML attributes. Prefer explicit ARIA roles/labels (e.g. role=button[name="..."], role=button[name*="Items per page: X"], [title="..."], [aria-label="..."], [aria-description="..."]).
   - For toggle switches, checkboxes, or switches below titles: Target PrimeNG/Angular switches using valid Playwright selectors like 'p-inputswitch:has-text("...")', 'p-toggleswitch:has-text("...")', 'div:has-text("...") >> role=switch', 'div:has-text("...") >> input', or 'role=switch[name*="..."]'.
   - Playwright Selector Syntax: ALWAYS use '>>' for locator chaining (e.g. 'parent >> child'). NEVER use non-standard syntax like '<<', 'prev=', 'switch:has(+', or invalid CSS pseudo-classes.
2. Keep actionType to one of: "click", "type", "select", "hover", "press", "navigate", "verify", "wait".
3. Dynamic Variables & Placeholders:
   - If user step asks to type a random role name, use value: "{{GEN_ROLE}}".
   - If user step asks to type a random user name or name, use value: "{{GEN_NAME}}".
   - If user step asks to type a random email, use value: "{{GEN_EMAIL}}".
   - When referring to a newly created role, item, or user in a table row (e.g. "created role"), use placeholder in selector: 'role=row[name*="{{GEN_ROLE}}"] >> button' or 'tr:has-text("{{GEN_ROLE}}") button'. DO NOT hardcode a specific generated string.
4. Return strict JSON according to the schema.
`;

  public async decideAction(
    stepAction: string,
    minifiedHtml: string,
    history: string[] = [],
    lastExecutionError: string | null = null,
    screenshotBuffer?: Buffer
  ): Promise<PlaywrightAction> {
    const parts: any[] = [];

    let promptText = `User Step: "${stepAction}"\n`;
    if (history.length > 0) {
      promptText += `Recent History:\n${history.join('\n')}\n`;
    }
    if (lastExecutionError) {
      promptText += `Previous Attempt Error: ${lastExecutionError}\n`;
    }
    const relevantDom = DomTrimmer.trimByRelevance(minifiedHtml, stepAction, 25000);
    promptText += `Current DOM:\n${relevantDom}`;

    parts.push(promptText);

    if (screenshotBuffer) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: screenshotBuffer.toString('base64')
        }
      });
    }

    let lastErr: any = null;
    let rateLimitCount = 0;

    for (const modelName of this.fallbackModels) {
      for (let keyAttempt = 0; keyAttempt < Math.max(1, this.apiKeys.length); keyAttempt++) {
        try {
          const genAI = this.getGenAI();
          const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: this.systemPrompt,
            generationConfig: {
              temperature: 0.0,
              responseMimeType: 'application/json',
              responseSchema: {
                type: SchemaType.OBJECT,
                properties: {
                  actionType: {
                    type: SchemaType.STRING,
                    format: 'enum',
                    enum: ['click', 'type', 'select', 'hover', 'press', 'navigate', 'verify', 'wait'],
                    description: 'Strictly one of the allowed actions: click, type, select, hover, press, navigate, verify, wait.'
                  },
                  selector: { 
                    type: SchemaType.STRING, 
                    description: 'CSS/XPath/ARIA selector. NEVER use nth=X or index-based matchers unless absolutely no semantic attribute exists.' 
                  },
                  value: { type: SchemaType.STRING, description: 'Text to type, select option, or expected value' },
                  description: { type: SchemaType.STRING, description: 'Explanation of chosen action' },
                  semanticRole: { type: SchemaType.STRING, description: 'ARIA role if applicable' },
                  semanticName: { type: SchemaType.STRING, description: 'Accessible name if applicable' }
                },
                required: ['actionType']
              }
            }
          });

          for (let retry = 0; retry < 2; retry++) {
            try {
              const generatePromise = model.generateContent(parts);
              const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('API_TIMEOUT: Gemini API request timed out after 20s')), 20000)
              );

              const result = await Promise.race([generatePromise, timeoutPromise]);
              const responseText = result.response.text();
              const parsed = JSON.parse(responseText) as PlaywrightAction;
              return parsed;
            } catch (err: any) {
              lastErr = err;
              const errMsg = err.message || '';
              const isRateLimit = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');

              if (isRateLimit) {
                rateLimitCount++;
                console.warn(`   ⚠️ Rate limit hit on Key #${this.currentKeyIndex + 1}. Fast-rotating to next key...`);
                this.rotateKey();
                
                // If every key in our pool has hit rate limits, throw QuotaExhaustedError to short-circuit retry loops
                if (rateLimitCount >= this.apiKeys.length) {
                  throw new Error('QuotaExhaustedError: All Gemini API keys are rate limited (429). Fast failing.');
                }
                
                await new Promise(res => setTimeout(res, 500));
                break;
              } else if (retry === 0) {
                console.warn(`   🌐 Transient API network issue / timeout (${errMsg}). Retrying in 1s on same key...`);
                await new Promise(res => setTimeout(res, 1000));
              }
            }
          }
        } catch (outerErr: any) {
          lastErr = outerErr;
          if (outerErr.message?.includes('QuotaExhaustedError')) {
            throw outerErr;
          }
        }
      }
    }

    throw new Error(`[BrainService] Failed to resolve action: ${lastErr?.message || 'All models/keys failed'}`);
  }
}
