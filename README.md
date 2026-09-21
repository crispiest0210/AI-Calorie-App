# Nutrition Tracker

A local-first calorie and macro tracker. Every nutrient number on screen traces
to a named database record; nothing is estimated or inferred.

Built from the [Product & Architecture Spec](https://claude.ai/artifact/27veyRAvDFfsyEg52tw4b9).
This repository implements **Milestone 1 — Phase 1, the Offline MVP**, together
with the Phase 0 foundations it stands on.

---

## What works today

Log food and water, set goals, and see the day add up — with no account, no
network and no telemetry.

| Requirement | State |
| --- | --- |
| F1 Goals: energy, macros (g or % of energy), fiber min, sodium max, water — dated and versioned | Done |
| F2 Search foods; Recent, Frequent and My foods tabs | Done (local FTS5) |
| F3 Log a food in grams, mL or a database portion | Done |
| F4 Meal slots; copy a meal from yesterday | Done |
| F5 Today: totals, remaining, per-meal breakdown | Done |
| F6 Water quick-adds and custom amounts | Done |
| F7 Custom food from a nutrition label | Done |
| F8 Offline logging and search | Done — there is no network code in the app at all |
| F12 History | Done as a 30-day list; charts are Phase 3 |
| Quick add (calories without a food) | Done |
| F9 barcode · F10 accounts and sync · F11 recipes · F13 photo · F14 export | Not in Milestone 1 |

Phase 2 has a head start: every user-data write already records itself in an
`outbox` table inside the same transaction, so nothing logged offline today is
invisible to sync when it arrives.

## Layout

```
packages/core        nutrition engine: nutrient codes, decimal math, unit
                     conversion, totals, goals, normalization, formatting
packages/db          SQLite schema (checked-in SQL), Drizzle mirror,
                     repositories, the day reader
packages/tokens      design tokens (light/dark, spacing, type, motion)
apps/mobile          Expo Router app (iOS + Android from one codebase)
tools/fdc-import     builds the bundled offline catalog from USDA/OFF data
fixtures/            committed USDA + Open Food Facts records: the golden test
                     set and the seed catalog's source
```

## Running it

```bash
pnpm install
pnpm catalog:build          # rebuilds apps/mobile/assets/catalog.sqlite
pnpm --filter @nt/mobile start
```

Then press `i` or `a` in the Expo CLI. The first launch copies the bundled
catalog into place; everything after that is local reads and writes.

```bash
pnpm -r run typecheck
pnpm -r run test            # 205 tests across engine, database, importer, UI
pnpm --filter @nt/core test:coverage   # 100% branches — the Phase 0 gate
pnpm lint
```

## The decisions worth knowing

**Nutrient values are decimal strings, never floats.** `packages/core/src/decimal.ts`
is the only place arithmetic happens. Two devices that see the same entries
produce byte-identical totals (review item R13), and a stray `parseFloat` on a
nutrient value is a lint error.

**AI supplies no numbers.** There is no model call anywhere in this milestone.
When photo analysis lands in Phase 4, the model proposes *what* and *how much*;
nutrients still come from `food_nutrient`.

**Missing is not zero.** A nutrient a source does not report stays absent, and
any day containing such an entry is shown as *incomplete* rather than quietly
summing a smaller number.

**Entries snapshot their food.** A log entry copies the per-100 g values it used.
A later catalog update never changes a past day — there is a test for exactly
that.

**Goals are dated.** Editing goals opens a new profile effective today; a day
read later is still scored against the goals that applied when it was logged.

**The catalog rebuild is byte-reproducible.** Row ids are derived from provider
and source reference rather than from the clock, so CI can prove the committed
`catalog.sqlite` matches the committed fixtures.

## Food data

The bundled catalog holds **464 foods**: 408 USDA Foundation, 36 FNDDS/SR
Legacy, and 20 Open Food Facts products, built from the records under
`fixtures/`.

Ten records were quarantined rather than served — real USDA rows whose
carbohydrate-by-difference is negative, which is plausible as research data and
not as a food you log. `apps/mobile/assets/catalog-quarantine.json` lists them
with reasons.

- USDA FoodData Central — public domain (CC0).
- Open Food Facts — ODbL; attributed in Settings.

### Two known gaps in the seeded data

1. **No household portions yet.** Portions ("1 cup, cooked") live only in FDC's
   *detail* endpoint, and the seeding run hit the `DEMO_KEY` rate limit before
   reaching it. The Amount step therefore offers grams for every food and
   portions for none. Fixing it is one command with a free key:

   ```bash
   FDC_API_KEY=<your key> pnpm --filter @nt/fdc-import run fetch:usda
   pnpm --filter @nt/fdc-import run prune
   pnpm catalog:build
   ```

   Portions are read from the source's portion table only — the app never
   invents one (spec 2.6.5), which is why grams-only is the honest state until
   that data is in hand.

2. **464 foods, not ~10k.** Production uses the monthly bulk download, which the
   importer already supports:

   ```bash
   # after unzipping the FDC JSON files into data/fdc/
   pnpm catalog:import -- --dir=data/fdc
   ```

   The builder fails the build if the result exceeds the 15 MB budget.

## Tests

| Layer | Where | What it holds |
| --- | --- | --- |
| Engine unit | `packages/core/test` | conversion, scaling, totals, goals, rounding, null propagation |
| Property (fast-check) | `packages/core/test/properties.test.ts` | order independence, linear scaling, day = Σ meals, no float artefacts |
| Golden | `packages/core/test/golden.test.ts` | 50 real FDC records + 20 real OFF products against committed snapshots |
| Repository | `packages/db/test` | outbox atomicity, tombstones and undo, snapshot immutability, goal versioning |
| Schema drift | `packages/db/test/schema-drift.test.ts` | the SQL migrations and the Drizzle mirror cannot diverge |
| Importer | `tools/fdc-import/test` | quarantine, barcode uniqueness, size budget, byte-reproducibility |
| Component | `apps/mobile/__tests__` | accessibility labels, the adjustable gram stepper, over-target copy |

CI additionally bundles the app with Metro, because a broken import resolves
fine in `tsc` and fails on device.

## Accessibility and tone

Every chart and ring has a text alternative; tap targets are at least 44 × 44 pt;
the gram stepper exposes increment and decrement actions; motion respects Reduce
Motion; over-target is shown by colour *and* a dashed pattern *and* a word.
Copy states facts ("120 kcal over"), never judgements.

VoiceOver and TalkBack passes are a manual gate before the phase ships and have
not been run in this environment.

## Not verified here

The app bundles for iOS and Android and every automated test passes, but it has
not been run on a simulator or device in this environment. The speed targets
(5.4) and performance budgets (2.13) need a real device, as does the
accessibility checklist.
