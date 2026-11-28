-- The staff access log also records the opening of one module's conversation
-- page, with the module it showed. module_id is set for those entries and no
-- others. The table's existing grants cover the new column.

alter table public.staff_access_log add column module_id text;

alter table public.staff_access_log drop constraint staff_access_log_opened;
alter table public.staff_access_log
  add constraint staff_access_log_opened check (opened in ('student_review', 'student_conversation')),
  add constraint staff_access_log_module check ((opened = 'student_conversation') = (module_id is not null));
