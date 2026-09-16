// Upgrade real legacy shapes in isolated PostgreSQL, then exercise the new public contracts.
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

test('achievement upgrade preserves history and enforces new search and save contracts', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
    `)
    const folder = new URL('../supabase/migrations/', import.meta.url)
    for (const file of (await readdir(folder)).filter((f) => f.endsWith('.sql')).sort()) {
      if (file === '20260916050000_achievements_staff_search.sql') {
        // Multiple dated awards, current-only, and unknown history all need lossless conversion.
        await db.exec(`
          insert into pathfinders(first_name,last_name,levels) values
            ('Dated','Example','[{"name":"Friend","outcome":"basic","year":"2020-21"}]'),
            ('Current','Example','[]'),('Undated','Example','[]'),('Unchanged','Example','[]');
          insert into current_data(pathfinder_id,status,current_title) values
            (1,'staff','["Master Guide","Club Director"]'),
            (2,'staff','["Master Guide"]'),(3,'staff','["Master Guide Leader"]'),
            (4,'pathfinder','["Friend"]');
          update current_data set current_activities='["Drill"]' where pathfinder_id=4;
          insert into staff_history(pathfinder_id,history) values
            (1,'[{"year":"2021-22","titles":["Master Guide","Club Director"]},
                 {"year":"2023-24","titles":["Master Guide"]},
                 {"year":"2024-25","titles":["Drill Instructor"]}]'),
            (3,'[{"year":null,"titles":["Master Guide","Master Guide Leader"]}]');
          insert into drill(pathfinder_id,team,years) values (4,'Precision','["2022-23"]');
        `)
      }
      const sql = await readFile(new URL(file, folder), 'utf8')
      if (!/^begin;/m.test(sql)) await db.exec('begin')
      await db.exec(sql)
      if (!/^begin;/m.test(sql)) await db.exec('commit')
    }
    const people = (await db.query('select id,levels from pathfinders order by id')).rows
    assert.deepEqual(people[0].levels, [
      { name: 'Friend', outcome: 'basic', year: '2020-21' },
      { name: 'Master Guide', year: '2021-22' },
      { name: 'Master Guide', year: '2023-24' },
    ])
    assert.deepEqual(people[1].levels, [{ name: 'Master Guide', year: null }])
    assert.deepEqual(people[2].levels, [{ name: 'Master Guide', year: null }])
    assert.deepEqual(people[3].levels, [])
    assert.deepEqual(
      (await db.query('select history from staff_history where pathfinder_id=1')).rows[0].history,
      [
        { year: '2021-22', titles: ['Club Director'] },
        { year: '2023-24', titles: [] },
        { year: '2024-25', titles: ['Drill Instructor'] },
      ],
    )
    assert.deepEqual(
      (await db.query('select current_title from current_data order by pathfinder_id')).rows.map(
        (r) => r.current_title,
      ),
      [['Club Director'], null, ['Master Guide Leader'], ['Friend']],
    )
    assert.equal(
      (await db.query("select count(*)::int n from staff_titles where title='Master Guide'"))
        .rows[0].n,
      0,
    )
    assert.equal(
      (await db.query("select count(*)::int n from staff_titles where title='Master Guide Leader'"))
        .rows[0].n,
      1,
    )
    assert.deepEqual(
      (await db.query('select years from drill where pathfinder_id=4')).rows[0].years,
      ['2022-23'],
    )
    assert.deepEqual(
      (
        await db.query(
          'select current_activities from private.achievements_registration_backup where pathfinder_id=4',
        )
      ).rows[0].current_activities,
      ['Drill'],
    )
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from information_schema.columns where table_schema='public' and column_name='current_activities'",
        )
      ).rows[0].n,
      0,
    )

    // Current status must not suppress historical Staff matching, and years cannot cross-match.
    await db.exec(`update current_data set status='not_active',current_title=null where pathfinder_id=1;
      set role authenticated;
      select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`)
    const matches = async (column, value) =>
      (
        await db.query(`select id from member_search where ${column} @> $1 order by id`, [
          JSON.stringify(value),
        ])
      ).rows.map((r) => r.id)
    assert.deepEqual(
      await matches('search_staff_titles', [{ name: 'Club Director', year: '2021-22' }]),
      [1],
    )
    assert.deepEqual(
      await matches('search_staff_titles', [{ name: 'Club Director', year: '2024-25' }]),
      [],
    )
    assert.deepEqual(await matches('search_staff_titles', [{ name: 'Master Guide Leader' }]), [3])
    assert.deepEqual(
      await matches('search_staff_titles', [{ name: 'Master Guide Leader', year: '2024-25' }]),
      [],
    )
    assert.deepEqual(await matches('levels', [{ name: 'Master Guide', year: '2023-24' }]), [1])
    assert.deepEqual(await matches('levels', [{ name: 'Master Guide' }]), [1, 2, 3])
    await assert.rejects(
      db.query('select * from private.achievements_registration_backup'),
      (e) => e.code === '42501',
    )

    const batch = async (year, entry) =>
      (await db.query('select add_to_records($1,$2,$3) result', [[4], year, JSON.stringify(entry)]))
        .rows[0].result[0]
    for (const outcome of ['basic', 'advanced', 'incomplete', null]) {
      assert.equal(
        (await batch('2025-26', { kind: 'level', name: 'Master Guide', outcome })).status,
        'error',
      )
    }
    assert.equal((await batch('2025-26', { kind: 'level', name: 'Master Guide' })).status, 'added')
    assert.equal(
      (await batch('2026-27', { kind: 'level', name: 'Master Guide' })).status,
      'already',
    )
    assert.deepEqual(
      (await db.query('select levels,years_active from pathfinders where id=4')).rows[0],
      {
        levels: [{ name: 'Master Guide', year: '2025-26' }],
        years_active: ['2025-26'],
      },
    )
    assert.equal((await batch(null, { kind: 'level', name: 'Friend' })).status, 'error')
    assert.equal(
      (await batch(null, { kind: 'level', name: 'Friend', outcome: 'advanced' })).status,
      'added',
    )
    await assert.rejects(
      db.exec(
        `update current_data set status='staff',current_title='["Master Guide"]' where pathfinder_id=4`,
      ),
      (e) => e.code === '23514',
    )

    const snapshot = async () =>
      (await db.query('select get_profile_for_edit(4) profile')).rows[0].profile
    const original = await snapshot()
    assert.equal('current_activities' in original.current_data[0], false)
    const proposed = structuredClone(original)
    proposed.pathfinders[0].levels[0].year = null
    await db.query('select update_profile(4,$1,$2)', [original, proposed])
    assert.equal((await snapshot()).pathfinders[0].levels[0].year, null)
    await assert.rejects(
      db.query('select update_profile(4,$1,$2)', [original, proposed]),
      (e) => e.code === '40001',
    )
    const latest = await snapshot()
    const invalid = structuredClone(latest)
    invalid.pathfinders[0].levels[0].outcome = 'basic'
    await assert.rejects(
      db.query('select update_profile(4,$1,$2)', [latest, invalid]),
      (e) => e.code === '23514',
    )
    assert.deepEqual(await snapshot(), latest)
    const retired = structuredClone(latest)
    retired.current_data[0].current_activities = []
    await assert.rejects(
      db.query('select update_profile(4,$1,$2)', [latest, retired]),
      /Only profile fields/,
    )
    const removed = structuredClone(latest)
    removed.pathfinders[0].levels = removed.pathfinders[0].levels.filter(
      (e) => e.name !== 'Master Guide',
    )
    await db.query('select update_profile(4,$1,$2)', [latest, removed])
    assert.equal(
      (await snapshot()).pathfinders[0].levels.some((e) => e.name === 'Master Guide'),
      false,
    )
    await db.exec('reset role; set role anon;')
    await assert.rejects(db.query('select * from member_search'), (e) => e.code === '42501')
  } finally {
    await db.close()
  }
})
