-- A product owner deletes a Cyber test record through the server. Deleting is
-- the only change a stored row allows: update stays revoked, so a record's
-- facts cannot be rewritten before or after it leaves the history.

grant delete on table public.cyber_test_records to service_role;
