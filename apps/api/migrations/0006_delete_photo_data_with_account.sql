-- Account deletion has to clear photo analysis data too. The quota table was
-- granted without delete, so the API could not remove a user's rows from it.
grant delete on photo_analysis_quota to app_api;
