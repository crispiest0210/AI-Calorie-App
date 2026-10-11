/**
 * The review screen's rules (spec 5.3), and the AI boundary where the user can
 * see it: the draft's calories come from the catalog food they accepted, never
 * from the model.
 */
import {
  draftEnergy,
  canConfirm,
  needsResolving,
  toConfirmedEntries,
  toReviewItems,
  type ReviewItem,
  type ServerDraft,
  type ServerDraftItem,
} from '@/photo/draft';
import { foods as foodsRepo, type Db, type FoodDetail } from '@nt/db';

jest.mock('@nt/db', () => ({ foods: { foodDetail: jest.fn() } }));

const food = (id: string, energy: string): FoodDetail => ({
  id,
  name: `Food ${id}`,
  brand: null,
  kind: 'generic',
  qualityTier: 'lab',
  energyPer100g: energy,
  gtin: null,
  sourceRef: 'src',
  sourceReleaseId: 'release',
  densityGPerMl: null,
  nutrientsPer100g: { energy_kcal: energy },
  derivations: { energy_kcal: 'reported' },
  portions: [],
});

const item = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  itemId: 'i1',
  label: 'white rice',
  description: null,
  preparation: 'cooked',
  identification: { confidence: 0.9, band: 'likely' },
  portionGrams: { estimate: '150', low: '100', high: '200', basis: null },
  occluded: false,
  matchStatus: 'matched',
  candidates: [{ foodId: 'rice', name: 'Rice', score: 0.9, qualityTier: 'lab' }],
  chosenFoodId: 'rice',
  grams: '150',
  gramsUntouched: true,
  food: food('rice', '130'),
  ...overrides,
});

describe('resolving', () => {
  it('holds Confirm until every item has a food behind it', () => {
    expect(canConfirm([item()])).toBe(true);
    expect(canConfirm([item(), item({ chosenFoodId: null, food: null })])).toBe(false);
    expect(needsResolving(item({ chosenFoodId: null, food: null }))).toBe(true);
  });

  it('refuses to confirm an empty draft', () => {
    expect(canConfirm([])).toBe(false);
  });
});

describe('the draft total', () => {
  it('is a range while anything is still the model’s estimate', () => {
    // 130 kcal/100 g across the model's 100–200 g range.
    const energy = draftEnergy([item()]);
    expect(energy.low).toBe('130');
    expect(energy.high).toBe('260');
    expect(energy.exact).toBeNull();
  });

  it('becomes one number once every amount has been accepted', () => {
    const energy = draftEnergy([item({ gramsUntouched: false, grams: '160' })]);
    expect(energy.exact).toBe('208');
    expect(energy.low).toBe('208');
    expect(energy.high).toBe('208');
  });

  it('comes from the catalog food, not from anything the model said', () => {
    // Same model estimate, a different accepted food: the number must move.
    const rice = draftEnergy([item({ gramsUntouched: false })]);
    const chicken = draftEnergy([item({ gramsUntouched: false, food: food('chicken', '165') })]);
    expect(rice.exact).toBe('195');
    expect(chicken.exact).toBe('247.5');
  });

  it('contributes nothing for an item with no food chosen yet', () => {
    const energy = draftEnergy([item({ chosenFoodId: null, food: null })]);
    expect(energy.exact).toBeNull();
    expect(energy.low).toBe('0');
  });

  it('adds several items together', () => {
    const energy = draftEnergy([
      item({ gramsUntouched: false, grams: '100' }),
      item({ itemId: 'i2', gramsUntouched: false, grams: '100', food: food('broccoli', '34') }),
    ]);
    expect(energy.exact).toBe('164');
  });
});

describe('what gets logged', () => {
  it('marks an untouched amount as an AI estimate and keeps the range', () => {
    const [entry] = toConfirmedEntries([item()]);
    expect(entry).toMatchObject({
      foodId: 'rice',
      grams: '150',
      gramsProvenance: 'ai_estimate',
      aiGramsLow: '100',
      aiGramsHigh: '200',
    });
  });

  it('marks an edited amount as adjusted, which drops the Estimated badge', () => {
    const [entry] = toConfirmedEntries([item({ gramsUntouched: false, grams: '175' })]);
    expect(entry!.gramsProvenance).toBe('ai_adjusted');
  });

  it('carries the catalog’s nutrients, so the entry snapshots real data', () => {
    const [entry] = toConfirmedEntries([item()]);
    expect(entry!.nutrientsPer100g).toEqual({ energy_kcal: '130' });
    expect(entry!.sourceReleaseId).toBe('release');
  });

  it('logs nothing for an unresolved item', () => {
    expect(toConfirmedEntries([item({ food: null, chosenFoodId: null })])).toEqual([]);
  });
});

describe('building the review list', () => {
  const foodDetail = foodsRepo.foodDetail as jest.Mock;
  const db = {} as Db;
  const serverItem = (overrides: Partial<ServerDraftItem> = {}): ServerDraftItem => {
    const { chosenFoodId, grams, gramsUntouched, food, ...base } = item();
    void chosenFoodId; void grams; void gramsUntouched; void food;
    return { ...base, ...overrides };
  };
  const draftOf = (...items: ServerDraftItem[]): ServerDraft => ({
    analysisId: 'a1',
    status: 'complete',
    model: null,
    notes: null,
    items,
  });

  beforeEach(() => {
    foodDetail.mockReset();
    foodDetail.mockImplementation((_db: Db, id: string) => food(id, '130'));
  });

  it('pre-selects the top candidate of a confident match and starts at the estimate', () => {
    const [review] = toReviewItems(db, draftOf(serverItem()));
    expect(review?.chosenFoodId).toBe('rice');
    expect(review?.food?.id).toBe('rice');
    expect(review?.grams).toBe('150');
    expect(review?.gramsUntouched).toBe(true);
  });

  it('leaves an unsure match for the user, even when a candidate scored well', () => {
    const unsure = serverItem({ identification: { confidence: 0.4, band: 'unsure' } });
    const [review] = toReviewItems(db, draftOf(unsure));
    expect(review?.chosenFoodId).toBeNull();
    expect(review?.food).toBeNull();
    expect(foodDetail).not.toHaveBeenCalled();
  });

  it('leaves an unmatched item unresolved', () => {
    const reviews = toReviewItems(db, draftOf(serverItem({ matchStatus: 'unmatched', candidates: [] })));
    expect(reviews[0]?.chosenFoodId).toBeNull();
    expect(canConfirm(reviews)).toBe(false);
  });
});
