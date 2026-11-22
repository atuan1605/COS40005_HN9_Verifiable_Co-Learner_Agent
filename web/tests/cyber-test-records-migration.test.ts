import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

const migrations = new URL('../../supabase/migrations/', import.meta.url)

it('keeps Cyber test records for the server alone, one immutable row per run with consistent counts', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create role supabase_auth_admin;
      create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz not null default now());
      create function auth.jwt() returns jsonb language sql stable
        as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean);
      create table storage.objects (id serial primary key, bucket_id text, name text);
      create function storage.foldername(name text) returns text[] language sql
        as $$ select string_to_array(name, '/') $$;
    `)
    for (const name of (await readdir(migrations)).sort().filter(name => name.endsWith('.sql'))) {
      await db.exec(await readFile(new URL(name, migrations), 'utf8'))
    }
    await db.exec('set role service_role')

    await db.exec(`
      insert into public.cyber_test_records
        (started_at, duration_ms, provider, model, verify_shield_on, stopped, suite_version,
         total_cases, finished_cases, passed, leaked, score, cases)
      values
        (now(), 4200, 'fake', 'Fake model', true, 'budget', 1, 120, 3, 2, 1, 0.6666667, '[{"type":"case"}]'::jsonb)
    `)
    const rows = (await db.query<{ started_at: Date, duration_ms: number, stopped: string, finished_cases: number, score: number, cases: unknown[] }>(
      'select started_at, duration_ms, stopped, finished_cases, score, cases from public.cyber_test_records',
    )).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ duration_ms: 4200, stopped: 'budget', finished_cases: 3 })
    expect(rows[0]!.started_at).toBeInstanceOf(Date)
    expect(rows[0]!.score).toBeCloseTo(2 / 3)
    expect(rows[0]!.cases).toEqual([{ type: 'case' }])

    // A record with no finished case stores a null score, never zero.
    await db.exec(`
      insert into public.cyber_test_records
        (started_at, duration_ms, provider, model, verify_shield_on, stopped, suite_version,
         total_cases, finished_cases, passed, leaked, score)
      values (now(), 0, 'real', 'deepseek-chat', false, 'cancelled', 1, 120, 0, 0, 0, null)
    `)
    const empty = (await db.query<{ score: number | null }>(
      `select score from public.cyber_test_records where stopped = 'cancelled'`,
    )).rows[0]
    expect(empty?.score).toBeNull()

    const insert = `insert into public.cyber_test_records
      (started_at, duration_ms, provider, model, verify_shield_on, stopped, suite_version,
       total_cases, finished_cases, passed, leaked, score, cases)
      values (now(), 1, 'fake', 'Fake model', true, 'complete', 1, `
    await expect(db.exec(`${insert}4, 5, 0, 0, null, '[]'::jsonb)`)).rejects.toMatchObject({ code: '23514' })
    await expect(db.exec(`${insert}3, 2, 2, 1, null, '[]'::jsonb)`)).rejects.toMatchObject({ code: '23514' })
    await expect(db.exec(`${insert}3, 0, 0, 0, 1.2, '[]'::jsonb)`)).rejects.toMatchObject({ code: '23514' })
    await expect(db.exec(`${insert}3, 0, 0, 0, null, '{}'::jsonb)`)).rejects.toMatchObject({ code: '23514' })
    await expect(db.exec(`${insert}3, 0, 0, 0, null, '[]'::jsonb)`.replace(`'Fake model'`, `''`))).rejects.toMatchObject({ code: '23514' })

    await expect(db.exec(`update public.cyber_test_records set model = 'other'`)).rejects.toMatchObject({ code: '42501' })

    // The product owner deletes one record; the other stays.
    await db.exec(`delete from public.cyber_test_records where stopped = 'cancelled'`)
    const kept = (await db.query<{ n: string }>('select count(*) as n from public.cyber_test_records')).rows[0]!.n
    expect(Number(kept)).toBe(1)

    for (const role of ['authenticated', 'anon']) {
      await db.exec(`reset role; set role ${role}`)
      await expect(db.query('select * from public.cyber_test_records')).rejects.toMatchObject({ code: '42501' })
      await expect(db.exec(`
        insert into public.cyber_test_records
          (started_at, duration_ms, provider, model, verify_shield_on, stopped, suite_version,
           total_cases, finished_cases, passed, leaked, score)
        values (now(), 0, 'fake', 'Fake model', true, 'complete', 1, 0, 0, 0, 0, null)
      `)).rejects.toMatchObject({ code: '42501' })
      await expect(db.exec('delete from public.cyber_test_records')).rejects.toMatchObject({ code: '42501' })
    }
  }
  finally {
    await db.close()
  }
})
