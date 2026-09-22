-- The source's own grouping ("Burgers", "Coffee"), so a common meal can be
-- browsed rather than only searched. FNDDS supplies it per food; Foundation
-- and SR Legacy use their broader food category.
alter table food add column category text;
create index food_category_idx on food (category) where category is not null and deleted_at is null;
