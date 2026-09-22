/**
 * Recipes (F11). A recipe behaves as a food everywhere else in the app, so
 * this screen only has to deal with what makes it a recipe: its ingredients
 * and its yield.
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatEnergy, formatGrams } from '@nt/core';
import { foods as foodsRepo, recipes as recipesRepo } from '@nt/db';
import { useDb, useDbQuery } from '@/db/provider';
import { spacing, useTheme } from '@/theme';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';

export default function RecipesScreen() {
  const db = useDb();
  const router = useRouter();
  const { colors } = useTheme();
  const list = useDbQuery((database) => recipesRepo.listRecipes(database), []);
  const userRelease = useDbQuery((database) => foodsRepo.activeSourceRelease(database, 'user'), []);

  const create = () => {
    if (userRelease === null) return;
    const id = recipesRepo.createRecipe(db, { name: 'New recipe', servings: '1', sourceReleaseId: userRelease });
    router.push({ pathname: '/recipe/[id]', params: { id } });
  };

  return (
    <Screen>
      <Card style={{ gap: spacing.md }}>
        <Text variant="title">Recipes</Text>
        <Text tone="muted">
          Build something once from its ingredients, then log it like any other food. Its nutrition is computed from
          what went in, and recomputed whenever you change it.
        </Text>
        <Button label="New recipe" onPress={create} disabled={userRelease === null} />
      </Card>

      {list.length === 0 ? (
        <Card>
          <Text variant="label" tone="faint">
            Nothing yet.
          </Text>
        </Card>
      ) : (
        list.map((recipe) => (
          <Card key={recipe.id} style={{ gap: spacing.xs }}>
            <Text
              variant="heading"
              accessibilityRole="button"
              accessibilityHint="Opens the recipe"
              onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: recipe.id } })}
            >
              {recipe.name}
            </Text>
            <Text variant="caption" tone="faint" numeric>
              {recipe.energyPer100g === null
                ? 'No ingredients yet'
                : `${formatEnergy(recipe.energyPer100g)} cal per 100 g · ${
                    recipe.portions[0] === undefined ? 'no serving' : `1 serving = ${formatGrams(recipe.portions[0].gramWeight)} g`
                  }`}
            </Text>
          </Card>
        ))
      )}

      <View style={{ height: spacing.xxl, backgroundColor: colors.background }} />
    </Screen>
  );
}
