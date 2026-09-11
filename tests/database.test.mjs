import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

let db
const viewer = '00000000-0000-0000-0000-000000000001'
const editor = '00000000-0000-0000-0000-000000000002'
const outsider = '00000000-0000-0000-0000-000000000003'
const events = ['drill_performance', 'drum_performance', 'honor_evaluations', 'bible_events', 'knots', 'tents', 'jump_rope', 'archery', 'lashing', 'burning_twine']
const names = ['Drill Performance', 'Drum Performance', 'Honor Evaluations', 'Bible Events', 'Knots Relay', 'Tents', 'Jump Rope', 'Archery', 'Lashing', 'Burning Twine']
const tables = ['pathfinders', 'honors', 'honors_earned', 'drill', 'drum_corps', 'pbe', 'tlt', ...events.map(t => `red_zone_${t}`)]

before(async () => {
  db = new PGlite()
  // Minimal Supabase Auth contract; the actual migration runs unchanged.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${viewer}'), ('${editor}'), ('${outsider}');
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20260908000000_pathfinder_database.sql', import.meta.url), 'utf8'))
  await db.exec(`insert into private.staff_access values ('${viewer}', 'viewer', now()), ('${editor}', 'editor', now());`)
  await db.exec(await readFile(new URL('../supabase/migrations/20260911000000_auth_users_are_staff.sql', import.meta.url), 'utf8'))
})
after(async () => { await db?.close() })

async function asRole(role, uid, run) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`)
  try { return await run() } finally { await db.exec('reset role') }
}
async function reject(sql, code = '23514') {
  await assert.rejects(db.query(sql), error => error.code === code)
}

test('creates all 17 application tables with RLS and denies anonymous access', async () => {
  for (const table of tables) {
    const { rows } = await db.query(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`)
    assert.equal(rows[0].relrowsecurity, true)
    await asRole('anon', null, () => reject(`select * from public.${table}`, '42501'))
  }
  await asRole('anon', null, () => reject('select public.current_staff_role()', '42501'))
})

test('validates level objects, unique options and consecutive school years', async () => {
  for (const expression of [
    `name = ''`, `years_active = '["2024-2026"]'`, `years_active = '["2024-2025", "2024-2025"]'`,
    `years_active = '{}'`, `levels = '[{"name":"Friend"}]'`,
    `levels = '[{"name":"Friend","advanced":null}]'`, `levels = '[{"name":"Other","advanced":false}]'`,
    `levels = '[{"name":"Friend","advanced":false},{"name":"Friend","advanced":true}]'`,
    `extracurriculars = '["Other"]'`, `red_zone_participation = '[2024]'`,
  ]) {
    await db.exec("insert into pathfinders(name) values ('Validation fixture')")
    await reject(`update pathfinders set ${expression} where name = 'Validation fixture'`)
    await db.exec("delete from pathfinders where name = 'Validation fixture'")
  }
})

test('editor creates a member and paired activity and Red Zone histories', async () => {
  await asRole('authenticated', editor, async () => {
    assert.equal((await db.query('select public.current_staff_role() as role')).rows[0].role, 'editor')
    await db.query(`insert into pathfinders(name,years_active,levels,extracurriculars,red_zone_participation)
      values ('Synthetic Member', '["2024-2025","2025-2026"]', '[{"name":"Friend","advanced":true}]',
      '["Drill","Drums","PBE","TLT"]', $1)`, [JSON.stringify(names)])
    const id = (await db.query("select id from pathfinders where name='Synthetic Member'")).rows[0].id
    await db.exec(`
      insert into drill values (${id}, '["2024-2025"]');
      insert into drum_corps(pathfinder_id,years,drum_played) values (${id}, '["2024-2025"]', 'Snare'), (${id}, '["2025-2026"]', 'Bass');
      insert into pbe(pathfinder_id,years,bible_book) values (${id}, '["2024-2025"]', 'Exodus');
      insert into tlt(pathfinder_id,years,tlt_operation) values (${id}, '["2025-2026"]', 'Teaching');
      insert into honors(name) values ('Synthetic Honor');
      insert into honors_earned(pathfinder_id,honor_id,year_earned) select ${id},id,2025 from honors;
    `)
    for (const t of events) {
      const named = ['honor_evaluations', 'bible_events'].includes(t)
      await db.exec(`insert into red_zone_${t}(pathfinder_id,year,placement${named ? ',name' : ''}) values
        (${id},2024,'1st Place'${named ? ",'Synthetic event'" : ''}),
        (${id},2025,'2nd Place'${named ? ",'Synthetic event'" : ''});`)
    }
    const { rows } = await db.query(`select name from pathfinders where name ilike '%synthetic%'
      and years_active @> '["2024-2025"]' and levels @> '[{"name":"Friend","advanced":true}]'
      and extracurriculars @> '["Drums"]' and red_zone_participation @> '["Archery"]'`)
    assert.equal(rows.length, 1)
    assert.deepEqual((await db.query('select year,placement from red_zone_archery order by year')).rows,
      [{ year: 2024, placement: '1st Place' }, { year: 2025, placement: '2nd Place' }])
    await reject(`insert into drum_corps(pathfinder_id,years,drum_played) values (${id}, '["2024-2025"]', 'Snare')`, '23505')
    await reject(`insert into red_zone_archery(pathfinder_id,year,placement) values (${id},2026,'Winner')`)
    await reject(`insert into red_zone_archery(pathfinder_id,year,placement) values (${id},2024,'3rd Place')`, '23505')
    await reject(`update pathfinders set extracurriculars='[]' where id=${id}`)
    await reject(`update pathfinders set red_zone_participation='[]' where id=${id}`)
    await db.exec("insert into pathfinders(name) values ('No participation')")
    const other = (await db.query("select id from pathfinders where name='No participation'")).rows[0].id
    await reject(`insert into drill values (${other}, '["2024-2025"]')`)
    await reject(`update drum_corps set pathfinder_id=${other} where pathfinder_id=${id}`)
    await reject(`insert into red_zone_archery(pathfinder_id,year,placement) values (${other},2024,'Participation')`)
    await reject(`insert into drill values (2147483647, '["2024-2025"]')`, '23503')
    await reject(`delete from pathfinders where id=${id}`, '42501')
  })
})

test('every Auth account can read and write without allowlist approval; deletion stays denied', async () => {
  for (const uid of [viewer, outsider]) {
    await asRole('authenticated', uid, async () => {
      assert.equal((await db.query('select public.current_staff_role() as role')).rows[0].role, 'editor')
      for (const table of tables) {
        assert.ok((await db.query(`select * from ${table}`)).rows.length > 0)
        const column = ['pathfinders', 'honors'].includes(table) ? 'name' : 'pathfinder_id'
        assert.ok((await db.query(`update ${table} set ${column}=${column} returning ${column}`)).rows.length > 0)
        await reject(`delete from ${table}`, '42501')
      }
      await db.query("insert into pathfinders(name) values ('New staff fixture')")
      await reject('select * from private.staff_access', '42501')
    })
  }
})

test('an authenticated database role without a user identity has no access', async () => {
  await asRole('authenticated', null, async () => {
    assert.equal((await db.query('select public.current_staff_role() as role')).rows[0].role, null)
    for (const table of tables) assert.equal((await db.query(`select * from ${table}`)).rows.length, 0)
    await reject("insert into pathfinders(name) values ('Forbidden')", '42501')
  })
})
