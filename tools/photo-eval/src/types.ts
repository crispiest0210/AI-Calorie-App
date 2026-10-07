/**
 * The labeled set (spec 2.7, Evaluation). One entry per photo: what is really
 * in it, and how much it really weighed.
 *
 * `foodId` is the catalog row a person picked as correct — not a name, because
 * names are what the matcher is being scored on. `grams` is a weighed value;
 * an eyeballed one measures the labeller, not the model.
 */
import { z } from 'zod';
import { modelResult } from '@nt/core';

export const labeledItem = z.object({
  /** The catalog food id a human confirmed is correct. */
  foodId: z.string(),
  /** What it weighed, on a scale, in grams. */
  grams: z.number().positive(),
  /** Free-text note for whoever reads a failure later. */
  note: z.string().optional(),
});

export const labeledMeal = z.object({
  id: z.string(),
  /** Path to the image, relative to the set directory. Absent in replay-only sets. */
  image: z.string().optional(),
  isFood: z.boolean().default(true),
  items: z.array(labeledItem),
});

export const labeledSet = z.object({
  name: z.string(),
  /** Catalog the ids refer to; a set is only meaningful against one. */
  catalogVersion: z.string(),
  meals: z.array(labeledMeal),
});

export type LabeledItem = z.infer<typeof labeledItem>;
export type LabeledMeal = z.infer<typeof labeledMeal>;
export type LabeledSet = z.infer<typeof labeledSet>;

/**
 * A model response saved next to the set. Replaying these makes the eval free,
 * deterministic and runnable in CI — which is what lets it gate a prompt
 * change. Live mode is for establishing a new baseline.
 */
export const recordedResponse = z.object({
  mealId: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  recordedAt: z.string(),
  /** Raw, before validation: the eval checks that validation would pass. */
  raw: z.unknown(),
  latencyMs: z.number().optional(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
});

export const recordedRun = z.object({
  setName: z.string(),
  responses: z.array(recordedResponse),
});

export type RecordedResponse = z.infer<typeof recordedResponse>;
export type RecordedRun = z.infer<typeof recordedRun>;

export type { z };
export { modelResult };
