-- Milestone 1 schema (spec section 3). Catalog tables are server-owned and
-- read-only on device; user tables carry the sync columns Phase 2 will use.
-- Numeric nutrient values are TEXT decimal strings so the engine's decimal
-- arithmetic round-trips exactly (review item R13).

------------------------------------------------------------------ catalog

create table nutrient_def (
  code             text primary key,
  display_name     text not null,
  unit             text not null,
  fdc_nutrient_ids text not null,          -- json array, priority order
  sort_order       integer not null
);

create table source_release (
  id          text primary key,
  provider    text not null check (provider in ('fdc','off','user','recipe')),
  dataset     text,
  version     text,
  released_on text,
  imported_at integer not null,
  is_active   integer not null default 0   -- the import job flips this; rollback re-points it
);

create table food (
  id                text primary key,
  kind              text not null check (kind in ('generic','branded','custom','recipe')),
  owner_user_id     text,                  -- null for catalog foods
  name              text not null,
  brand             text,
  gtin              text,
  source_release_id text not null references source_release(id),
  source_ref        text,
  quality_tier      text not null check (quality_tier in ('lab','survey','label','crowd','user','computed')),
  density_g_per_ml  text,                  -- null disables mL logging for this food
  superseded_by     text references food(id),
  server_rev        integer,
  updated_at        integer,
  deleted_at        integer
);
create index food_name_idx on food (name);
create unique index food_gtin_idx on food (gtin)
  where gtin is not null and owner_user_id is null and superseded_by is null;

create table food_nutrient (
  food_id         text not null references food(id) on delete cascade,
  nutrient_code   text not null references nutrient_def(code),
  amount_per_100g text not null,
  derivation      text not null default 'reported'
                  check (derivation in ('reported','converted','derived','computed')),
  primary key (food_id, nutrient_code)
) without rowid;

create table food_portion (
  id          text primary key,
  food_id     text not null references food(id) on delete cascade,
  label       text not null,
  gram_weight text not null,
  source      text not null check (source in ('fdc','off_serving','user')),
  position    integer not null default 0
);
create index food_portion_food_idx on food_portion (food_id, position);

-- Offline search (spec 2.3). Standalone FTS5 table kept in step by triggers,
-- because food.id is a uuid and external-content tables need an integer rowid.
create virtual table food_fts using fts5 (
  name, brand, food_id unindexed, tokenize = "unicode61 remove_diacritics 2"
);

create trigger food_fts_insert after insert on food begin
  insert into food_fts (rowid, name, brand, food_id) values (new.rowid, new.name, coalesce(new.brand, ''), new.id);
end;
create trigger food_fts_delete after delete on food begin
  delete from food_fts where rowid = old.rowid;
end;
create trigger food_fts_update after update of name, brand on food begin
  update food_fts set name = new.name, brand = coalesce(new.brand, '') where rowid = new.rowid;
end;

------------------------------------------------------------------ recipes

create table recipe_ingredient (
  id                 text primary key,
  recipe_food_id     text not null references food(id) on delete cascade,
  ingredient_food_id text not null references food(id),
  grams              text not null,
  position           integer not null default 0,
  server_rev integer, updated_at integer, deleted_at integer
);
create index recipe_ingredient_recipe_idx on recipe_ingredient (recipe_food_id, position);

create table recipe_meta (
  food_id            text primary key references food(id) on delete cascade,
  total_cooked_grams text,                 -- null => sum of raw ingredient grams
  servings           text not null default '1'
);

------------------------------------------------------------------ logging

create table log_entry (
  id                 text primary key,     -- uuidv7 from the device
  local_date         text not null,        -- the device's calendar day at log time
  logged_at          integer not null,
  tz_offset_min      integer not null,
  meal_slot          text not null check (meal_slot in ('breakfast','lunch','dinner','snack')),
  entry_kind         text not null check (entry_kind in ('food','quick_add')),
  food_id            text references food(id),
  amount_value       text not null,
  amount_unit        text not null check (amount_unit in ('g','ml','portion','kcal')),
  portion_id         text references food_portion(id),
  grams              text,                 -- resolved grams; null only for quick_add
  grams_provenance   text not null check (grams_provenance in ('user','portion','ai_estimate','ai_adjusted')),
  ai_grams_low       text,
  ai_grams_high      text,
  -- snapshot taken at log time: catalog updates never change a past day
  food_name_snapshot text not null,
  source_release_id  text references source_release(id),
  nutrients_per_100g text,                 -- json {code: decimal string}
  nutrients_absolute text,                 -- json, used by quick_add
  note               text,
  server_rev integer, updated_at integer not null, deleted_at integer,
  check (entry_kind = 'quick_add' or (food_id is not null and grams is not null and nutrients_per_100g is not null)),
  check (entry_kind = 'food' or nutrients_absolute is not null)
);
create index log_entry_day_idx on log_entry (local_date) where deleted_at is null;
create index log_entry_food_idx on log_entry (food_id, logged_at desc) where deleted_at is null;
create index log_entry_rev_idx on log_entry (server_rev);

------------------------------------------------------------------ goals

create table goal_profile (
  id              text primary key,
  effective_from  text not null unique,    -- applies from this local date until the next profile
  water_target_ml integer,
  server_rev integer, updated_at integer not null, deleted_at integer
);

create table goal_target (
  goal_profile_id text not null references goal_profile(id) on delete cascade,
  nutrient_code   text not null references nutrient_def(code),
  kind            text not null check (kind in ('target','min','max','range')),
  value_low       text,
  value_high      text,
  value           text,
  basis           text not null default 'absolute' check (basis in ('absolute','pct_energy')),
  primary key (goal_profile_id, nutrient_code)
) without rowid;

------------------------------------------------------------------ water

create table water_entry (
  id         text primary key,
  local_date text not null,
  logged_at  integer not null,
  amount_ml  integer not null check (amount_ml between 1 and 5000),
  server_rev integer, updated_at integer not null, deleted_at integer
);
create index water_entry_day_idx on water_entry (local_date) where deleted_at is null;

create table water_preset (
  id         text primary key,
  label      text,
  amount_ml  integer not null check (amount_ml between 1 and 5000),
  position   integer not null default 0,
  server_rev integer, updated_at integer, deleted_at integer
);

------------------------------------------------------------- sync + settings

-- Written in the same transaction as the row it describes, so a crash can
-- never leave a change unsynced (spec 2.10). Phase 2 drains it.
create table outbox (
  seq        integer primary key autoincrement,
  table_name text not null,
  row_id     text not null,
  op         text not null check (op in ('upsert','delete')),
  created_at integer not null,
  attempts   integer not null default 0,
  last_error text
);
create index outbox_row_idx on outbox (table_name, row_id);

create table sync_state (
  key   text primary key,
  value text
);

create table app_setting (
  key   text primary key,
  value text not null
);

-- A day's entries with the food name and tier the UI needs, so Today is one
-- statement. Totals are NOT summed here: they are computed by the engine in
-- decimal arithmetic, which SQLite's REAL sums cannot reproduce exactly.
create view v_day_entry as
select
  e.id, e.local_date, e.logged_at, e.meal_slot, e.entry_kind, e.food_id,
  e.amount_value, e.amount_unit, e.portion_id, e.grams, e.grams_provenance,
  e.food_name_snapshot, e.nutrients_per_100g, e.nutrients_absolute, e.note,
  f.brand as food_brand, f.quality_tier as food_quality_tier, p.label as portion_label
from log_entry e
left join food f on f.id = e.food_id
left join food_portion p on p.id = e.portion_id
where e.deleted_at is null;
