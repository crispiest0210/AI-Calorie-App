/**
 * The model adapter interface (spec 2.7, Provider). Everything above this line
 * knows only `analyzeMealImage`; swapping vendors is implementing it again.
 */
import type { ModelResult } from '@nt/core';

export interface MealImage {
  /** Re-encoded server-side before it reaches here (spec 2.12). */
  bytes: Uint8Array;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface AnalysisOutcome {
  result: ModelResult;
  /** Recorded on every analysis so the eval can attribute a change (2.7). */
  model: string;
  promptVersion: string;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number };
  /** The unvalidated response, for the eval harness and for debugging. */
  raw: unknown;
}

export type AnalysisFailureKind = 'timeout' | 'not_food' | 'schema' | 'refused' | 'upstream';

export class AnalysisError extends Error {
  constructor(
    readonly kind: AnalysisFailureKind,
    message: string,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'AnalysisError';
  }
}

export interface MealImageAnalyzer {
  analyzeMealImage(image: MealImage): Promise<AnalysisOutcome>;
}
