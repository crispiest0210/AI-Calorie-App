/**
 * One recipe: its ingredients, its yield, and what that works out to. Every
 * number here is computed from the ingredients — nothing is entered directly,
 * which is what makes a recipe traceable to the same sources as its parts.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  CORE_CODES,
  NUTRIENT_DEFS,
  formatGrams,
  formatWithUnit,
  num,
} from '@nt/core';
import { foods as foodsRepo, recipes as recipesRepo } from '@nt/db';
import { useDb, useDbQuery } from '@/db/provider';
import { spacing, useTheme } from '@/theme';
import { successFeedback } from '@/hooks/useHaptics';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { NumberField } from '@/components/NumberField';
import { LabelledTextInput } from '@/components/LabelledTextInput';

export default function RecipeScreen() {
  const db = useDb();
  const router = useRouter();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const recipe = useDbQuery((database) => recipesRepo.readRecipe(database, id), [id]);
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  if (recipe === null) {
    return (
      <Screen>
        <Card>
          <Text tone="muted">This recipe has been removed.</Text>
        </Card>
      </Screen>
    );
  }

  const per100g = recipe.computed?.per100g ?? {};
  const servingGrams = recipe.computed?.servingGrams ?? null;

  return (
    <Screen>
      <Card style={{ gap: spacing.lg }}>
        <LabelledTextInput
          label="Name"
          value={nameDraft ?? recipe.name}
          onChangeText={setNameDraft}
          onBlur={() => {
            if (nameDraft !== null && nameDraft.trim() !== '') recipesRepo.updateRecipe(db, recipe.id, { name: nameDraft });
            setNameDraft(null);
          }}
        />
        <NumberField
          label="Servings"
          value={recipe.servings}
          onChange={(value) => recipesRepo.updateRecipe(db, recipe.id, { servings: num(value || '1') })}
          step={1}
        />
        <NumberField
          label="Cooked weight (optional)"
          value={recipe.totalCookedGrams ?? ''}
          onChange={(value) =>
            recipesRepo.updateRecipe(db, recipe.id, { totalCookedGrams: value.trim() === '' ? null : num(value) })
          }
          suffix="g"
          step={50}
        />
        <Text variant="caption" tone="faint">
          Leave the cooked weight blank to use the raw ingredients added up. Set it when the dish loses water — that is
          what concentrates the numbers.
        </Text>
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text variant="heading">Ingredients</Text>
        {recipe.ingredients.length === 0 && (
          <Text variant="label" tone="faint">
            Add what goes in, and the nutrition follows.
          </Text>
        )}
        {recipe.ingredients.map((ingredient) => (
          <View key={ingredient.id} style={{ gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
            <Text numberOfLines={2}>{ingredient.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <NumberField
                  label="Grams"
                  value={ingredient.grams}
                  onChange={(value) => {
                    if (value.trim() === '' || Number.parseFloat(value) <= 0) return;
                    recipesRepo.updateIngredient(db, recipe.id, ingredient.id, num(value));
                  }}
                  step={10}
                />
              </View>
              <Text
                accessibilityRole="button"
                accessibilityLabel={`Remove ${ingredient.name}`}
                variant="label"
                tone="accent"
                onPress={() => recipesRepo.removeIngredient(db, recipe.id, ingredient.id)}
              >
                Remove
              </Text>
            </View>
          </View>
        ))}
        <Button
          label="Add ingredient"
          variant="secondary"
          onPress={() => router.push({ pathname: '/log', params: { pickFor: recipe.id } })}
        />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text variant="heading">Per serving</Text>
        {recipe.computed === null ? (
          <Text variant="label" tone="faint">
            Nothing to compute yet.
          </Text>
        ) : (
          <>
            <Text variant="caption" tone="muted" numeric>
              1 serving = {formatGrams(servingGrams)} g · yield {formatGrams(recipe.computed.cookedGrams)} g
            </Text>
            {CORE_CODES.map((code) => {
              const per100 = per100g[code];
              const perServing =
                per100 === undefined || servingGrams === null
                  ? null
                  : num((Number.parseFloat(per100) * Number.parseFloat(servingGrams)) / 100);
              return (
                <View key={code} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="label" tone="muted">
                    {NUTRIENT_DEFS[code].displayName}
                  </Text>
                  <Text variant="label" numeric tone={perServing === null ? 'faint' : 'default'}>
                    {perServing === null ? 'not reported' : formatWithUnit(perServing, code)}
                  </Text>
                </View>
              );
            })}
            {recipe.incompleteCodes.length > 0 && (
              <Text variant="caption" tone="over">
                An ingredient does not report {recipe.incompleteCodes.map((c) => NUTRIENT_DEFS[c].displayName.toLowerCase()).join(', ')}, so
                this recipe cannot either.
              </Text>
            )}
          </>
        )}
      </Card>

      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Button
          label="Log this recipe"
          disabled={recipe.computed === null}
          onPress={() => {
            successFeedback();
            router.push({ pathname: '/amount', params: { foodId: recipe.id } });
          }}
        />
        <Button
          label="Delete recipe"
          variant="ghost"
          onPress={() => {
            foodsRepo.softDeleteFood(db, recipe.id);
            router.back();
          }}
        />
      </View>
    </Screen>
  );
}
