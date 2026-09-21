alter table food add column category text;
create index food_category_idx on food (category) where category is not null and deleted_at is null;
