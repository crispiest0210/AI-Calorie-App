-- Account deletion removes a user's photo analysis quota rows along with the
-- rest of their data (spec 2.8, F14). 0004 granted the API role select,
-- insert and update on the quota table but not delete, so it could not.
grant delete on photo_analysis_quota to app_api;
