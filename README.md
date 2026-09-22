# Nutrition Tracker

A local-first calorie and macro tracker. Every nutrient number on screen traces
to a named database record; nothing is estimated or inferred.

Built from the [Product & Architecture Spec](https://claude.ai/artifact/27veyRAvDFfsyEg52tw4b9).
This repository implements **Phases 0–3**: the foundations, the offline MVP,
accounts and sync, and recipes, trends and the performance pass.

---

## What works today

Log food and water, set goals, and see the day add up — with no account, no
network and no telemetry.

| Requirement | State |
| --- | --- |
| F1 Goals: energy, macros (g or % of energy), fiber min, sodium max, water — dated and versioned | Done |
| F2 Search foods; Recent, Frequent and My foods tabs | Done (local FTS5) |
| F3 Log a food by serving, in grams, or in mL | Done — opens on the source's serving |
| F4 Meal slots; copy a meal from yesterday | Done |
| F5 Today: totals, remaining, per-meal breakdown | Done |
| F6 Water quick-adds and custom amounts | Done |
| F7 Custom food from a nutrition label | Done |
| F8 Offline logging and search | Done — there is no network code in the app at all |
| F12 History | Done as a 30-day list; charts are Phase 3 |
| Quick add (calories without a food) | Done |
| F9 Barcode scan → branded food | Done |
| F10 Account and multi-device sync | Done |
| F14 Export and account deletion | Done |
| F11 Recipes: ingredients, yield, per-serving nutrition | Done |
| F12 7 and 30-day trends against the goals of each day | Done |
| F13 Photo analysis | Not yet — Phase 4 |

An account is optional. Everything works without one; signing in adds sync and
barcode lookup and nothing else. Anything logged before signing in is already
in the outbox, so the first sync adopts it — that is the local-to-account
upgrade, with no separate migration step.

## Layout

```
packages/core        nutrition engine: nutrient codes, decimal math, unit
                     conversion, totals, goals, normalization, formatting
packages/db          SQLite schema (checked-in SQL), Drizzle mirror,
                     repositories, the day reader, the client sync engine
apps/api             Hono API on Postgres: sync, catalog, barcode, export
packages/tokens      design tokens (light/dark, spacing, type, motion)
apps/mobile          Expo Router app (iOS + Android from one codebase)
tools/fdc-import     builds the bundled offline catalog from USDA/OFF data
fixtures/            committed USDA + Open Food Facts records: the golden test
                     set and the seed catalog's source
```

## Running it

```bash
pnpm install
pnpm --filter @nt/mobile start
```

The bundled catalog is committed, so this works on a fresh clone. To rebuild it
from source:

```bash
pnpm catalog:fetch    # ~17 MB of pinned USDA releases into data/fdc
pnpm catalog:build    # → apps/mobile/assets/catalog.sqlite
```

Then press `i` or `a` in the Expo CLI. The first launch copies the bundled
catalog into place; everything after that is local reads and writes.

```bash
pnpm -r run typecheck
pnpm -r run test            # 253 tests: engine, database, importer, UI, API
pnpm --filter @nt/core test:coverage   # 100% branches — the Phase 0 gate
pnpm lint
```

The API tests need a real Postgres, because row-level security is what they
check and nothing in memory enforces it. They start an embedded server on their
own; set `DATABASE_URL` to use one you already have, which is what CI does.

### Running with an account

Accounts are off until the app knows where to talk to. Fill in `expo.extra` in
`apps/mobile/app.json`:

```json
{ "apiBaseUrl": "https://…", "supabaseUrl": "https://….supabase.co", "supabaseAnonKey": "…" }
```

With those blank the app runs in local mode, which is a supported state rather
than a degraded one.

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

**Servings come from the source or not at all.** The Amount step opens on one
of the food's own household servings — "1 hamburger", "1 cup, cooked" — with
grams one tap away. Where the source lists no serving, the step opens on 100 g
rather than inventing one (spec 2.6.5). FNDDS writes some portion labels as
numeric codes and uses a literal "Quantity not specified" row; both are dropped,
because neither tells a person anything.

**Entries snapshot their food.** A log entry copies the per-100 g values it used.
A later catalog update never changes a past day — there is a test for exactly
that.

**Goals are dated.** Editing goals opens a new profile effective today; a day
read later is still scored against the goals that applied when it was logged.

**Sync is an outbox and a cursor, not a CRDT.** Each write records itself in an
`outbox` row inside the same transaction, so a crash cannot lose a change.
Push assigns every row the next value of one global sequence; pull asks for
everything above the device's cursor. Conflicts are row-level last-writer-wins
by server arrival order — single-user data is nearly append-only, and field
level merging was cut for that reason (review R6).

**A recipe is a food.** It carries `kind = 'recipe'`, its nutrients are
computed from its ingredients and recomputed on every change, and it gets a
"1 serving" portion from its yield. Everything downstream — logging, snapshots,
totals, sync — treats it as an ordinary food and needs to know nothing about
recipes. Its generated serving row is updated in place rather than replaced,
because entries logged against it hold that portion's id.

**Charts carry their meaning three ways.** Over-target bars cross the target
line, are hatched, and say "over target" when read aloud. The chart colours are
their own tokens, not the UI accent: the accent is deliberately low-chroma and
reads grey at mark size, and accent-vs-over failed a colourblindness check. The
replacements were chosen by running the palette validator against each surface
(`packages/tokens/src/index.ts` records the numbers).

**Row-level security is the second layer, not the only one.** The API checks
the JWT, and then Postgres checks again: the API connects as a role that does
not own the tables, and every user table has a policy keyed to the caller.
Thirteen tests attack that boundary directly as a second user.

**The catalog rebuild is byte-reproducible.** Row ids are derived from provider
and source reference rather than from the clock, so CI can prove the committed
`catalog.sqlite` matches the committed fixtures.

## Food data

The bundled catalog holds **13,566 foods** from three pinned USDA releases:

| Dataset | Foods | What it is good for |
| --- | --- | --- |
| Foundation 2026-04-30 | 395 | lab-analyzed whole foods |
| SR Legacy 2018-04 | 7,793 | ingredients, and named restaurant items |
| FNDDS (survey) 2024-10-31 | 5,430 | what people actually eat: burgers, sandwiches, coffee |

**98% of foods carry at least one household serving**, which is what makes
logging by serving the default rather than a nicety.

22 records were quarantined rather than served — mostly real USDA rows whose
carbohydrate-by-difference is negative, which is plausible as research data and
not as a food you log. `apps/mobile/assets/catalog-quarantine.json` lists them
with reasons.

The releases are pinned in `tools/fdc-import/src/fetch-bulk.mjs`. Bumping one
moves every nutrient number in the app, so it belongs in a commit of its own.
CI refetches them and rebuilds, and fails if the result differs from the
committed file byte for byte.

`fixtures/` keeps a small committed slice of real records for the golden tests,
and `pnpm catalog:seed` builds a working catalog from it with no network at all.

- USDA FoodData Central — public domain (CC0).
- Open Food Facts — ODbL; attributed in Settings.

### Size

6.34 MB in the app download, 22.4 MB on disk. Spec 2.3 budgets the catalog at
"< 15 MB compressed" and 2.13 budgets the whole download at 60 MB; the build
fails if the compressed size goes over, and reports both numbers.

## Tests

| Layer | Where | What it holds |
| --- | --- | --- |
| Engine unit | `packages/core/test` | conversion, scaling, totals, goals, rounding, null propagation |
| Property (fast-check) | `packages/core/test/properties.test.ts` | order independence, linear scaling, day = Σ meals, no float artefacts |
| Golden | `packages/core/test/golden.test.ts` | 50 real FDC records + 20 real OFF products against committed snapshots |
| Repository | `packages/db/test` | outbox atomicity, tombstones and undo, snapshot immutability, goal versioning |
| Schema drift | `packages/db/test/schema-drift.test.ts` | the SQL migrations and the Drizzle mirror cannot diverge |
| Importer | `tools/fdc-import/test` | quarantine, barcode uniqueness, size budget, byte-reproducibility |
| Meal browsing | `packages/db/test` | featured categories first, thin categories hidden, plainest food first |
| Recipes | `packages/db/test/recipes.test.ts` | recompute on every change, yield and servings, a logged day unmoved by later edits |
| Performance | `packages/db/test/performance.test.ts` | the 2.13 budgets against the real 13.5k catalog, with a query-plan check |
| Component | `apps/mobile/__tests__` | accessibility labels, the adjustable gram stepper, over-target copy, safe-area insets, database reactivity |
| API integration | `apps/api/test/api.test.ts` | every endpoint, problem+json, idempotency, rate limits |
| Security — RLS | `apps/api/test/rls.test.ts` | user B reads and writes nothing of user A, as SQL and through the API |
| Convergence | `apps/api/test/convergence.test.ts` | two devices, offline edits on both, identical totals; tombstones; export round-trip |

CI additionally bundles the app with Metro, because a broken import resolves
fine in `tsc` and fails on device.

## Accessibility and tone

Every chart and ring has a text alternative; tap targets are at least 44 × 44 pt;
the gram stepper exposes increment and decrement actions; motion respects Reduce
Motion; over-target is shown by colour *and* a dashed pattern *and* a word.
Copy states facts ("120 kcal over"), never judgements.

VoiceOver and TalkBack passes are a manual gate before the phase ships and have
not been run in this environment.

## Performance

The budgets in spec 2.13 are enforced by `packages/db/test/performance.test.ts`
against the real catalog, at a tenth of the spec's numbers — the spec's are for
a mid-range phone, and the headroom is what makes them survivable there.

Two things were needed to hold the search budget once the catalog grew to
13.5k foods:

- Energy is looked up only for the rows that survive the ranking limit. Doing
  it per candidate cost one subquery for every match, which took a broad query
  to 103 ms.
- A query must be at least two characters. A single letter matches thousands of
  foods and says almost nothing; the cheapest way to stay in budget is not to
  run it.

Worst case went from 103 ms to 9 ms with identical ranking.

## Deviations from the spec, and why

**Export returns the document, not a signed URL to a zip.** The spec has
`GET /v1/me/export` hand back a link to object storage. There is no bucket in
this milestone — that arrives with photo analysis in Phase 4 — so the endpoint
returns the JSON document directly, with the log entries also rendered as CSV
inside it. The round-trip test asserts the exported numbers reproduce the
totals the app showed.

**Sign-in is a one-time code by email.** Sign in with Apple and Google are the
same Supabase flow with a provider token, but both need native configuration
and a development build to test honestly. Email codes work in Expo Go today;
the other two are a config change, not a rewrite.

## Not verified here

Every automated test passes and the app bundles for iOS and Android, but:

- It has not been run against a real Supabase project. Auth is exercised with
  locally-signed HS256 tokens, which is exactly what Supabase issues, but the
  hosted `/auth/v1/otp` flow has not been hit for real.
- Barcode scanning has not been tested against a physical barcode.
- The speed targets (5.4) and the VoiceOver / TalkBack checklist still need a
  real device. The 2.13 budgets are measured, but on a developer machine
  against a slowdown assumption, not on the mid-range Android the spec names.
- Motion is stubbed out under Jest: Reanimated 4 cannot be imported in that
  environment, so `apps/mobile/__mocks__` stands in for it and animation itself
  is only verified by running the app.
