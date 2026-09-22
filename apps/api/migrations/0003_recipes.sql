-- Recipes (spec 3.3). A recipe is a food of kind 'recipe'; these tables hold
-- what it is made of. They carry no sync columns of their own: a recipe syncs
-- as one aggregate with its parent food, so it can never arrive half-written
-- (review R3).
create table recipe_meta (
  food_id            uuid primary key references food(id) on delete cascade,
  total_cooked_grams numeric,
  servings           numeric not null default 1
);

create table recipe_ingredient (
  id                 uuid primary key,
  recipe_food_id     uuid not null references food(id) on delete cascade,
  ingredient_food_id uuid not null,
  grams              numeric not null check (grams > 0),
  position           int not null default 0
);
create index recipe_ingredient_recipe_idx on recipe_ingredient (recipe_food_id, position);

alter table recipe_meta enable row level security;
alter table recipe_ingredient enable row level security;

-- Reachable exactly when the recipe's food row is.
create policy recipe_meta_owner on recipe_meta for all
  using (exists (select 1 from food f where f.id = food_id and f.owner_user_id = app.current_user_id()))
  with check (exists (select 1 from food f where f.id = food_id and f.owner_user_id = app.current_user_id()));

create policy recipe_ingredient_owner on recipe_ingredient for all
  using (exists (select 1 from food f where f.id = recipe_food_id and f.owner_user_id = app.current_user_id()))
  with check (exists (select 1 from food f where f.id = recipe_food_id and f.owner_user_id = app.current_user_id()));

grant select, insert, update, delete on recipe_meta, recipe_ingredient to app_api;
