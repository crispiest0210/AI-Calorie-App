-- Server schema (spec section 3). The same logical model as the device's
-- SQLite, plus the columns only a server can own: user_id and server_rev.
--
-- Numeric nutrient values are `numeric`, not float: the engine reads them back
-- as decimal strings so every device computes the same totals (review R13).

create extension if not exists pg_trgm;

create schema if not exists app;

/*
 * The identity every row-level policy is written against.
 *
 * On Supabase the JWT claims are set per request and `auth.uid()` reads them;
 * self-hosted, the API sets `app.user_id` inside the request transaction.
 * Reading both means one set of policies works in either place.
 */
create or replace function app.current_user_id() returns uuid
language plpgsql stable as $$
declare
  claims text := current_setting('request.jwt.claims', true);
  direct text := current_setting('app.user_id', true);
begin
  if claims is not null and claims <> '' then
    return (claims::jsonb ->> 'sub')::uuid;
  end if;
  if direct is not null and direct <> '' then
    return direct::uuid;
  end if;
  return null;
end;
$$;

-- One global counter. Every user-table write takes the next value, so a client
-- can ask for "everything after rev N" and get it in a total order (2.10).
create sequence server_rev_seq;

------------------------------------------------------------------ catalog

create table nutrient_def (
  code             text primary key,
  display_name     text not null,
  unit             text not null,
  fdc_nutrient_ids jsonb not null,
  sort_order       int not null
);

create table source_release (
  id          uuid primary key,
  provider    text not null check (provider in ('fdc','off','user','recipe')),
  dataset     text,
  version     text,
  released_on date,
  imported_at timestamptz not null default now(),
  is_active   boolean not null default false
);

create table food (
  id                uuid primary key,
  kind              text not null check (kind in ('generic','branded','custom','recipe')),
  owner_user_id     uuid,                      -- null for catalog foods
  name              text not null,
  brand             text,
  gtin              text,
  source_release_id uuid not null references source_release(id),
  source_ref        text,
  quality_tier      text not null check (quality_tier in ('lab','survey','label','crowd','user','computed')),
  density_g_per_ml  numeric,
  superseded_by     uuid references food(id),
  search_tsv        tsvector generated always as (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(brand,''))) stored,
  server_rev        bigint,
  updated_at        timestamptz,
  deleted_at        timestamptz
);
create index food_tsv_idx on food using gin (search_tsv);
create index food_trgm_idx on food using gin (name gin_trgm_ops);
create index food_owner_rev_idx on food (owner_user_id, server_rev);
create unique index food_gtin_idx on food (gtin)
  where gtin is not null and owner_user_id is null and superseded_by is null;

create table food_nutrient (
  food_id         uuid not null references food(id) on delete cascade,
  nutrient_code   text not null references nutrient_def(code),
  amount_per_100g numeric not null,
  derivation      text not null default 'reported'
                  check (derivation in ('reported','converted','derived','computed')),
  primary key (food_id, nutrient_code)
);

create table food_portion (
  id          uuid primary key,
  food_id     uuid not null references food(id) on delete cascade,
  label       text not null,
  gram_weight numeric not null check (gram_weight > 0),
  source      text not null check (source in ('fdc','off_serving','user')),
  position    int not null default 0
);
create index food_portion_food_idx on food_portion (food_id, position);

-- Barcodes looked up from Open Food Facts are cached permanently: OFF limits
-- reads to 15/min per IP and every user shares this server's IP (review R14).
create table barcode_cache (
  gtin       text primary key,
  food_id    uuid references food(id),
  provider   text not null,
  looked_up  timestamptz not null default now(),
  not_found  boolean not null default false
);

------------------------------------------------------------------ user data

create table log_entry (
  id                 uuid primary key,
  user_id            uuid not null,
  local_date         date not null,
  logged_at          timestamptz not null,
  tz_offset_min      int not null,
  meal_slot          text not null check (meal_slot in ('breakfast','lunch','dinner','snack')),
  entry_kind         text not null check (entry_kind in ('food','quick_add')),
  food_id            uuid,
  amount_value       numeric not null,
  amount_unit        text not null check (amount_unit in ('g','ml','portion','kcal')),
  portion_id         uuid,
  grams              numeric,
  grams_provenance   text not null check (grams_provenance in ('user','portion','ai_estimate','ai_adjusted')),
  food_name_snapshot text not null,
  source_release_id  uuid,
  nutrients_per_100g jsonb,
  nutrients_absolute jsonb,
  note               text,
  server_rev         bigint not null default nextval('server_rev_seq'),
  updated_at         timestamptz not null,
  deleted_at         timestamptz
);
create index log_entry_pull_idx on log_entry (user_id, server_rev);
create index log_entry_day_idx on log_entry (user_id, local_date) where deleted_at is null;

create table water_entry (
  id         uuid primary key,
  user_id    uuid not null,
  local_date date not null,
  logged_at  timestamptz not null,
  amount_ml  int not null check (amount_ml between 1 and 5000),
  server_rev bigint not null default nextval('server_rev_seq'),
  updated_at timestamptz not null,
  deleted_at timestamptz
);
create index water_entry_pull_idx on water_entry (user_id, server_rev);

create table water_preset (
  id         uuid primary key,
  user_id    uuid not null,
  label      text,
  amount_ml  int not null check (amount_ml between 1 and 5000),
  position   int not null default 0,
  server_rev bigint not null default nextval('server_rev_seq'),
  updated_at timestamptz not null,
  deleted_at timestamptz
);
create index water_preset_pull_idx on water_preset (user_id, server_rev);

create table goal_profile (
  id              uuid primary key,
  user_id         uuid not null,
  effective_from  date not null,
  water_target_ml int,
  targets         jsonb not null default '[]'::jsonb,
  server_rev      bigint not null default nextval('server_rev_seq'),
  updated_at      timestamptz not null,
  deleted_at      timestamptz,
  unique (user_id, effective_from)
);
create index goal_profile_pull_idx on goal_profile (user_id, server_rev);

create table user_settings (
  user_id     uuid primary key,
  units       text not null default 'metric',
  keep_photos boolean not null default false,
  server_rev  bigint not null default nextval('server_rev_seq'),
  updated_at  timestamptz not null default now()
);

-- A repeated POST within 24 h returns the stored response rather than acting
-- twice, which is what makes a retry after a dropped connection safe (4.1).
create table idempotency_key (
  key        text primary key,
  user_id    uuid not null,
  response   jsonb not null,
  created_at timestamptz not null default now()
);

-- Tombstones are purged after 90 days; a device whose cursor predates the
-- purge gets 410 and re-pulls in full (2.10).
create table sync_watermark (
  user_id          uuid primary key,
  purged_below_rev bigint not null default 0
);

------------------------------------------------------------------ RLS

alter table log_entry    enable row level security;
alter table water_entry  enable row level security;
alter table water_preset enable row level security;
alter table goal_profile enable row level security;
alter table user_settings enable row level security;
alter table idempotency_key enable row level security;
alter table sync_watermark enable row level security;
alter table food          enable row level security;
alter table food_nutrient enable row level security;
alter table food_portion  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['log_entry','water_entry','water_preset','goal_profile','user_settings','idempotency_key','sync_watermark']
  loop
    execute format(
      'create policy %I_owner on %I using (user_id = app.current_user_id()) with check (user_id = app.current_user_id())',
      t, t);
  end loop;
end $$;

-- Catalog rows are readable by everyone signed in; a custom food is readable
-- and writable only by the person who made it.
create policy food_read on food for select
  using (owner_user_id is null or owner_user_id = app.current_user_id());
create policy food_write on food for insert
  with check (owner_user_id = app.current_user_id());
create policy food_update on food for update
  using (owner_user_id = app.current_user_id())
  with check (owner_user_id = app.current_user_id());
create policy food_delete on food for delete
  using (owner_user_id = app.current_user_id());

create policy food_nutrient_read on food_nutrient for select
  using (exists (select 1 from food f where f.id = food_id
                 and (f.owner_user_id is null or f.owner_user_id = app.current_user_id())));
create policy food_nutrient_write on food_nutrient for all
  using (exists (select 1 from food f where f.id = food_id and f.owner_user_id = app.current_user_id()))
  with check (exists (select 1 from food f where f.id = food_id and f.owner_user_id = app.current_user_id()));

create policy food_portion_read on food_portion for select
  using (exists (select 1 from food f where f.id = food_id
                 and (f.owner_user_id is null or f.owner_user_id = app.current_user_id())));
create policy food_portion_write on food_portion for all
  using (exists (select 1 from food f where f.id = food_id and f.owner_user_id = app.current_user_id()))
  with check (exists (select 1 from food f where f.id = food_id and f.owner_user_id = app.current_user_id()));

------------------------------------------------------------------ roles

-- The API connects as this role. It is not the table owner, so RLS is never
-- bypassed by accident — that is the second layer behind the auth middleware.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api nologin;
  end if;
end $$;

grant usage on schema public, app to app_api;
grant select on nutrient_def, source_release to app_api;
grant select, insert, update, delete on food, food_nutrient, food_portion to app_api;
grant select, insert, update, delete on log_entry, water_entry, water_preset, goal_profile, user_settings, idempotency_key, sync_watermark to app_api;
grant select on barcode_cache to app_api;
grant insert, update on barcode_cache to app_api;
grant usage on sequence server_rev_seq to app_api;
