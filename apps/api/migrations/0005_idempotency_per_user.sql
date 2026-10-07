-- An Idempotency-Key is chosen by the client, so it is only unique per user.
-- With key alone as the primary key, a second user sending the same key hit
-- the other user's row (hidden by row-level security) and the push failed.
alter table idempotency_key drop constraint idempotency_key_pkey;
alter table idempotency_key add primary key (user_id, key);
