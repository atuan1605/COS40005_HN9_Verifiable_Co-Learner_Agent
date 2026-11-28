import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

const migrations = new URL('../../supabase/migrations/', import.meta.url)
const an = 'a11a11a1-1111-4111-8111-111111111111'

it('keeps the staff access log for the server alone, adds rows and refuses a change', async () => {
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
    await db.exec(`insert into auth.users (id, email) values ('${an}', 'an@example.com')`)
    await db.exec('set role service_role')

    await db.exec(`
      insert into public.staff_access_log (actor_email, actor_role, student_id, course_id, opened)
      values ('lecturer@example.com', 'lecturer', '${an}', 'intro_python', 'student_review')
    `)
    const rows = (await db.query<{ actor_email: string, actor_role: string, student_id: string, opened: string, created_at: Date }>(
      'select actor_email, actor_role, student_id, opened, created_at from public.staff_access_log',
    )).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actor_email: 'lecturer@example.com', actor_role: 'lecturer', student_id: an, opened: 'student_review' })
    expect(rows[0]!.created_at).toBeInstanceOf(Date)

    await expect(db.exec(`update public.staff_access_log set actor_email = 'x@example.com'`)).rejects.toMatchObject({ code: '42501' })
    await expect(db.exec('delete from public.staff_access_log')).rejects.toMatchObject({ code: '42501' })
    await expect(db.exec(`
      insert into public.staff_access_log (actor_email, actor_role, student_id, opened)
      values ('an@example.com', 'student', '${an}', 'student_review')
    `)).rejects.toMatchObject({ code: '23514' })
    await expect(db.exec(`
      insert into public.staff_access_log (actor_email, actor_role, student_id, opened)
      values ('owner@example.com', 'administrator', '${an}', 'something_else')
    `)).rejects.toMatchObject({ code: '23514' })

    // An opening of one module's conversation keeps the module; an opening of the review has none.
    await db.exec(`
      insert into public.staff_access_log (actor_email, actor_role, student_id, course_id, opened, module_id)
      values ('owner@example.com', 'administrator', '${an}', 'intro_python', 'student_conversation', 'loops')
    `)
    expect((await db.query('select opened, module_id from public.staff_access_log order by id')).rows).toEqual([
      { opened: 'student_review', module_id: null },
      { opened: 'student_conversation', module_id: 'loops' },
    ])
    for (const [opened, moduleId] of [['student_conversation', 'null'], ['student_review', `'loops'`]]) {
      await expect(db.exec(`
        insert into public.staff_access_log (actor_email, actor_role, student_id, opened, module_id)
        values ('owner@example.com', 'administrator', '${an}', '${opened}', ${moduleId})
      `)).rejects.toMatchObject({ code: '23514' })
    }

    for (const role of ['authenticated', 'anon']) {
      await db.exec(`reset role; set role ${role}`)
      await expect(db.query('select * from public.staff_access_log')).rejects.toMatchObject({ code: '42501' })
      await expect(db.exec(`
        insert into public.staff_access_log (actor_email, actor_role, student_id, opened)
        values ('an@example.com', 'administrator', '${an}', 'student_review')
      `)).rejects.toMatchObject({ code: '42501' })
    }

    // Deleting a student's records completely leaves the record of who looked.
    await db.exec('reset role; set role service_role')
    await db.exec(`delete from public.students where id = '${an}'`)
    expect((await db.query('select id from public.staff_access_log')).rows).toHaveLength(2)
  }
  finally {
    await db.close()
  }
})
