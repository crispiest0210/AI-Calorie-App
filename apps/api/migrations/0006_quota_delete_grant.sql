-- Deleting an account has to clear the photo quota rows too (F14); app_api was
-- only granted select, insert and update on them.
grant delete on photo_analysis_quota to app_api;
