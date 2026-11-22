-- One immutable record per Cyber test run, written by the server when the run
-- stream closes. A record identifies the run without opening it: times, model,
-- provider, shield state, how it stopped, the suite version, the counts and the
-- score. `cases` holds the case results in the same shape the run streamed,
-- including prompts, leaked fragments and reply excerpts. Only the server reads
-- and writes it; reads and deletes come later through product-owner routes.

create table public.cyber_test_records (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  duration_ms integer not null,
  provider text not null,
  model text not null,
  verify_shield_on boolean not null,
  stopped text not null,
  suite_version integer not null,
  total_cases integer not null,
  finished_cases integer not null,
  passed integer not null,
  leaked integer not null,
  score real,
  cases jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint cyber_test_records_duration check (duration_ms >= 0),
  constraint cyber_test_records_provider check (provider in ('fake', 'real')),
  constraint cyber_test_records_model check (length(model) > 0),
  constraint cyber_test_records_stopped check (stopped in ('complete', 'budget', 'cancelled')),
  constraint cyber_test_records_suite_version check (suite_version > 0),
  constraint cyber_test_records_cases_total check (total_cases >= 0 and finished_cases >= 0 and finished_cases <= total_cases),
  constraint cyber_test_records_counts check (passed >= 0 and leaked >= 0 and passed + leaked = finished_cases),
  constraint cyber_test_records_score check (score is null or (score >= 0 and score <= 1)),
  constraint cyber_test_records_cases check (jsonb_typeof(cases) = 'array')
);

create index cyber_test_records_created on public.cyber_test_records (created_at desc, id desc);

alter table public.cyber_test_records enable row level security;

revoke all on table public.cyber_test_records from public, anon, authenticated, service_role;
grant select, insert on table public.cyber_test_records to service_role;
revoke all on sequence public.cyber_test_records_id_seq from public, anon, authenticated;
grant usage, select on sequence public.cyber_test_records_id_seq to service_role;
