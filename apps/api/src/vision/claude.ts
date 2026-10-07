/**
 * The vision provider: Claude, called through the Anthropic SDK.
 *
 * Why this model. The task is one image in, a small structured object out, on
 * a 12-second p95 budget (spec 2.13). Three things decided it:
 *
 *  - Structured outputs enforce the schema server-side, which is what turns
 *    "the model must never return a nutrient value" from a prompt request into
 *    a property of the request. The schema in `@nt/core` has no nutrient field
 *    anywhere in it.
 *  - No tools are given to the model, so text inside a photo saying "ignore
 *    your instructions" has nothing to act on — it can only become a label the
 *    user sees and rejects (review item R12).
 *  - Effort is a dial the eval can turn. Start at `medium`: this is
 *    identification and estimation rather than reasoning, and the eval will say
 *    whether `low` holds or `high` is worth paying for.
 */
import Anthropic from '@anthropic-ai/sdk';
import { ANALYSIS_PROMPT, MODEL_OUTPUT_SCHEMA, findNutrientFields, modelResult } from '@nt/core';
import { AnalysisError, type AnalysisOutcome, type MealImage, type MealImageAnalyzer } from './adapter';

/** Bump when ANALYSIS_PROMPT or the schema changes; the eval keys off it. */
export const PROMPT_VERSION = 'photo-v1';

export const DEFAULT_MODEL = 'claude-opus-5';

/** Spec 2.7: synchronous with a 30 s ceiling; a queue only if p95 exceeds 12 s. */
export const ANALYSIS_TIMEOUT_MS = 30_000;

export interface ClaudeAnalyzerOptions {
  client?: Anthropic;
  model?: string;
  /** low | medium | high | xhigh | max. Tune with the eval, not by feel. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  timeoutMs?: number;
}

export class ClaudeMealImageAnalyzer implements MealImageAnalyzer {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: NonNullable<ClaudeAnalyzerOptions['effort']>;
  private readonly timeoutMs: number;

  constructor(options: ClaudeAnalyzerOptions = {}) {
    this.client = options.client ?? new Anthropic();
    this.model = options.model ?? DEFAULT_MODEL;
    this.effort = options.effort ?? 'medium';
    this.timeoutMs = options.timeoutMs ?? ANALYSIS_TIMEOUT_MS;
  }

  async analyzeMealImage(image: MealImage): Promise<AnalysisOutcome> {
    const startedAt = Date.now();

    let response;
    try {
      response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 4096,
          // No `tools`: the model has nothing to act with, so text inside the
          // photo cannot become an action (review item R12).
          output_config: {
            effort: this.effort,
            format: { type: 'json_schema', schema: MODEL_OUTPUT_SCHEMA },
          },
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: image.mediaType,
                    data: Buffer.from(image.bytes).toString('base64'),
                  },
                },
                { type: 'text', text: ANALYSIS_PROMPT },
              ],
            },
          ],
        },
        { timeout: this.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        throw new AnalysisError('timeout', 'the model took longer than the analysis budget');
      }
      if (error instanceof Anthropic.APIError) {
        throw new AnalysisError('upstream', `the model service returned ${error.status}`);
      }
      throw new AnalysisError('upstream', error instanceof Error ? error.message : 'unknown failure');
    }

    if (response.stop_reason === 'refusal') {
      throw new AnalysisError('refused', 'the model declined to analyse this image');
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AnalysisError('schema', 'the model did not return JSON', text);
    }

    /*
     * The schema should make this impossible. It is checked anyway, on every
     * live response and not only in the eval, because "a nutrient number the
     * app did not compute" is the one failure this product cannot ship.
     */
    const leaks = findNutrientFields(raw);
    if (leaks.length > 0) {
      throw new AnalysisError('schema', `the model returned a nutrient field: ${leaks[0]!.path}`, raw);
    }

    const parsed = modelResult.safeParse(raw);
    if (!parsed.success) {
      throw new AnalysisError('schema', parsed.error.issues[0]?.message ?? 'response did not validate', raw);
    }
    if (!parsed.data.is_food) {
      throw new AnalysisError('not_food', 'this photo does not appear to show food', raw);
    }

    return {
      result: parsed.data,
      model: this.model,
      promptVersion: PROMPT_VERSION,
      latencyMs: Date.now() - startedAt,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      raw,
    };
  }
}
