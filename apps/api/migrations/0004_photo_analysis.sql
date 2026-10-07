-- Photo analysis (spec 3.7). No column here ever holds a nutrient value: the
-- draft stores what the model said (a label and a weight) and which catalog
-- rows it might be. Nutrition is read from food_nutrient when the user
-- confirms, exactly as it is for a typed search.

create table photo_analysis (
  id             uuid primary key,
  user_id        uuid not null,
  status         text not null default 'pending'
                 check (status in ('pending','analyzed','confirmed','abandoned','failed')),
  storage_path   text,                       -- user_id/analysis_id.jpg, private bucket
  model          text,
  prompt_version text,
  latency_ms     int,
  is_food        boolean,
  notes          text,
  failure_kind   text,
  created_at     timestamptz not null default now(),
  analyzed_at    timestamptz,
  resolved_at    timestamptz,
  -- When the image may be deleted. The sweeper works off this, so retention is
  -- a property of the row rather than of whichever job last ran (spec 2.8).
  image_expires_at timestamptz,
  image_deleted_at timestamptz
);
create index photo_analysis_user_idx on photo_analysis (user_id, created_at desc);
create index photo_analysis_sweep_idx on photo_analysis (image_expires_at)
  where image_deleted_at is null and storage_path is not null;

create table photo_analysis_item (
  id            uuid primary key,
  analysis_id   uuid not null references photo_analysis(id) on delete cascade,
  position      int not null,
  label         text not null,
  description   text,
  preparation   text,
  confidence    numeric not null,
  grams_estimate numeric not null,
  grams_low     numeric not null,
  grams_high    numeric not null,
  portion_basis text,
  occluded      boolean not null default false,
  match_status  text not null check (match_status in ('matched','unmatched')),
  -- Candidate foods, best first: [{foodId, name, score, qualityTier}]. Energy
  -- is not stored here; the client reads it from the food record.
  candidates    jsonb not null default '[]'::jsonb
);
create index photo_analysis_item_analysis_idx on photo_analysis_item (analysis_id, position);

alter table photo_analysis enable row level security;
alter table photo_analysis_item enable row level security;

create policy photo_analysis_owner on photo_analysis for all
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

create policy photo_analysis_item_owner on photo_analysis_item for all
  using (exists (select 1 from photo_analysis a where a.id = analysis_id and a.user_id = app.current_user_id()))
  with check (exists (select 1 from photo_analysis a where a.id = analysis_id and a.user_id = app.current_user_id()));

grant select, insert, update, delete on photo_analysis, photo_analysis_item to app_api;

-- Per-user daily cap on analyses (review item R12): cost control, and a limit
-- on how much an abusive client can spend.
create table photo_analysis_quota (
  user_id   uuid not null,
  local_day date not null,
  used      int not null default 0,
  primary key (user_id, local_day)
);
alter table photo_analysis_quota enable row level security;
create policy photo_analysis_quota_owner on photo_analysis_quota for all
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());
grant select, insert, update on photo_analysis_quota to app_api;
