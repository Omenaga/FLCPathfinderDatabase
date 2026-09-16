// Replay the complete migration history with legacy fixtures, then verify current editing and history rules.

import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

test('member revision preserves history and enforces roles, ranges and access', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`)
    const folder = new URL('../supabase/migrations/', import.meta.url)
    for (const file of (await readdir(folder)).filter((f) => f.endsWith('.sql')).sort()) {
      if (file === '20260914000000_member_revision.sql') {
        await db.exec(`insert into pathfinders(name,years_active,levels) values ('Justin Wu','["2023-2024"]','[{"name":"Friend","advanced":true}]');
 insert into current_data(pathfinder_id,school_year,status,grade) values (1,'2026-2027','graduated',10);
 insert into drill values (1,'["2023-2024"]');
 insert into pbe(pathfinder_id,history) values (1,'[{"year":"2021-2022","books":["Ruth"]}]');
 insert into tlt(pathfinder_id,history) values (1,'[{"year":2024,"operations":["Teaching"]}]');
 insert into red_zone_burning_twine(pathfinder_id,year,placement) values (1,2024,'1st Place');`)
      }
      if (file === '20260915110000_current_season_default.sql') {
        // Reproduce the live schema drift and blank season that hid the Staff row.
        await db.exec(
          'alter table current_data alter column school_year drop not null; alter table current_data drop constraint current_data_school_year_check; update current_data set school_year=null',
        )
      }
      if (file === '20260915120000_staff_drum_history.sql') {
        await db.exec(`insert into staff_titles values ('Director'),('Deputy');
  insert into staff_history(pathfinder_id,years,title) values
   (1,'["2023-24","2024-25"]','Director'),(1,'["2023-24"]','Deputy'),(1,'["2022-23"]',null);
  insert into drum_corps(pathfinder_id,years,drum_played,history_role) values
   (1,'["2023-24","2024-25"]','Snare','pathfinder'),(1,'["2023-24"]','Bass','pathfinder'),(1,'["2025-26"]','Tenor','staff');`)
      }
      if (file === '20260915130000_current_title_json.sql')
        await db.exec(
          `update current_data set current_title='Club Director',current_activities='["Drill"]' where pathfinder_id=1`,
        )
      if (file === '20260915190000_remove_history_role.sql')
        await db.exec(`
  insert into drill(pathfinder_id,team,years,history_role) values(1,null,'["2024-25"]','staff');
  insert into drum_corps(pathfinder_id,history,history_role) values(1,'[{"year":"2023-24","drums":["Bass","Quad"]}]','staff')
   on conflict(pathfinder_id,history_role) do update set history=drum_corps.history || excluded.history;
  insert into pbe(pathfinder_id,history,history_role) select pathfinder_id,history,'staff' from pbe;
  insert into tlt(pathfinder_id,history,history_role) select pathfinder_id,history,'staff' from tlt;
  insert into honors(name) values('Migration Honor');
  insert into honors_earned(pathfinder_id,honor_id,year_earned,history_role)
   select 1,id,'2023-24',r from honors cross join unnest(array['pathfinder','staff']) r;
  insert into red_zone_burning_twine(pathfinder_id,year,placement,history_role)
   select pathfinder_id,year,placement,'staff' from red_zone_burning_twine;
  insert into red_zone_archery(pathfinder_id,year,placement,history_role) values
   (1,'2023-24','1st Place','pathfinder'),(1,'2023-24','2nd Place','staff');
 `)
      const sql = await readFile(new URL(file, folder), 'utf8')
      if (!/^begin;/m.test(sql)) await db.exec('begin')
      await db.exec(sql)
      if (!/^begin;/m.test(sql)) await db.exec('commit')
    }
    const row = (await db.query('select * from member_search where id=1')).rows[0]
    assert.equal(
      (await db.query('select school_year from current_data where pathfinder_id=1')).rows[0]
        .school_year,
      '2026-27',
    )
    assert.deepEqual(row.current_title, ['Club Director'])
    assert.deepEqual(row.current_activities, ['N/A'])
    assert.equal(row.first_name, 'Justin')
    assert.equal(row.last_name, 'Wu')
    assert.equal(row.status, 'staff')
    assert.deepEqual(row.years_active, ['2023-24'])
    assert.deepEqual(row.levels, [{ name: 'Friend', outcome: 'advanced', year: null }])
    assert.ok(row.search_activity_years.includes('TLT (2023)'))
    assert.ok(row.search_event_years.includes('Burning Twine (2024)'))
    assert.ok(row.search_event_years.includes('Burning Twine (2023-24)'))
    assert.ok(row.search_activity_years.includes('TLT (2023-24)'))
    assert.ok(
      row.search_activity_details.some(
        (r) => r.name === 'TLT' && r.year === '2023-24' && r.detail === 'Teaching',
      ),
    )
    assert.ok(
      row.search_event_details.some(
        (r) => r.name === 'Burning Twine' && r.year === '2023-24' && r.detail === '1st Place',
      ),
    )
    assert.deepEqual(
      (await db.query('select history from staff_history where pathfinder_id=1')).rows[0].history,
      [
        { year: '2022-23', titles: [] },
        { year: '2023-24', titles: ['Deputy', 'Director'] },
        { year: '2024-25', titles: ['Director'] },
      ],
    )
    assert.deepEqual(
      (await db.query('select history from drum_corps where pathfinder_id=1')).rows[0].history,
      [
        { year: '2023-24', drums: ['Bass', 'Quad', 'Snare'] },
        { year: '2024-25', drums: ['Snare'] },
        { year: '2025-26', drums: ['Tenor'] },
      ],
    )
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from information_schema.columns where table_schema='public' and column_name='history_role'",
        )
      ).rows[0].n,
      0,
    )
    assert.deepEqual(
      (await db.query('select years from drill where pathfinder_id=1 and team is null')).rows[0]
        .years,
      ['2023-24', '2024-25'],
    )
    for (const table of ['pbe', 'tlt', 'honors_earned', 'red_zone_burning_twine'])
      assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n, 1)
    assert.equal((await db.query('select count(*)::int n from red_zone_archery')).rows[0].n, 2)
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from staff_titles where title in ('Club Director','Friend Counselor','Master Guide','Trailer')",
        )
      ).rows[0].n,
      4,
    )
    assert.ok(row.search_years.includes('2022-23'))
    assert.ok(
      row.search_activity_details.some(
        (r) => r.name === 'Drums' && r.year === '2023-24' && r.detail === 'Bass',
      ),
    )
    assert.ok(
      !row.search_activity_details.some(
        (r) => r.name === 'Drums' && r.year === '2024-25' && r.detail === 'Bass',
      ),
    )
    assert.equal(
      (await db.query('select count(*)::int as n from private.staff_drum_history_backup')).rows[0]
        .n,
      6,
    )
    await assert.rejects(
      db.exec("delete from staff_titles where title='Director'"),
      (e) => e.code === '23503',
    )
    await assert.rejects(
      db.exec("update staff_titles set title='Renamed' where title='Deputy'"),
      (e) => e.code === '23503',
    )
    for (const [table, key, invalid] of [
      ['staff_history', 'titles', 'Unknown'],
      ['drum_corps', 'drums', 'Piano'],
    ]) {
      for (const history of [
        [],
        [{ year: '2023-25', [key]: [] }],
        [{ year: '2023-24', [key]: [invalid] }],
        [
          { year: '2023-24', [key]: [] },
          { year: '2023-24', [key]: [] },
        ],
        [{ year: '2023-24', [key]: null }],
        [{ year: '2023-24', [key]: [], extra: true }],
      ]) {
        await assert.rejects(
          db.query(`update ${table} set history=$1 where pathfinder_id=1`, [
            JSON.stringify(history),
          ]),
          (e) => e.code === '23514',
        )
      }
    }
    await db.exec("insert into staff_titles values ('Counselor')")
    assert.equal((await db.query('select history from pbe')).rows[0].history[0].year, '2021-22')
    assert.equal(
      (await db.query('select year from red_zone_burning_twine')).rows[0].year,
      '2023-24',
    )
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`,
    )
    await db.exec(`update pathfinders set notes=E'One sentence.\nAnother paragraph.',birth_date='2000-01-02' where id=1;
 insert into drill(pathfinder_id,team,years) values (1,'Adult','["2025-26"]');`)
    await assert.rejects(
      db.exec(`update current_data set current_title='["Friend"]' where pathfinder_id=1`),
      (e) => e.code === '23514',
    )
    await db.exec(`update current_data set current_title='["Counselor"]' where pathfinder_id=1`)
    await db.exec(
      `update staff_history set history=history || '[{"year":"2025-26","titles":["Counselor"]}]' where pathfinder_id=1`,
    )
    await db.exec(
      `update current_data set current_title='["Club Director","Drill Instructor"]',current_activities='["Drums"]' where pathfinder_id=1`,
    )
    assert.deepEqual(
      (await db.query('select current_activities from current_data where pathfinder_id=1')).rows[0]
        .current_activities,
      ['N/A'],
    )
    for (const title of [
      '"Club Director"',
      '["Club Director","Club Director"]',
      '["Unknown"]',
      '{}',
      'null',
    ]) {
      await assert.rejects(
        db.query('update current_data set current_title=$1 where pathfinder_id=1', [title]),
        (e) => e.code === '23514',
      )
    }
    await db.exec(
      `update current_data set status='pathfinder',current_title='["Friend"]' where pathfinder_id=1`,
    )
    assert.deepEqual(
      (await db.query('select current_activities from current_data where pathfinder_id=1')).rows[0]
        .current_activities,
      [],
    )
    await assert.rejects(
      db.exec(`update current_data set status='parent' where pathfinder_id=1`),
      (e) => e.code === '23514',
    )
    await assert.rejects(
      db.exec(`update pathfinders set years_active='["2023-25"]' where id=1`),
      (e) => e.code === '23514',
    )
    await assert.rejects(
      db.exec(`update pbe set history='[{"year":"2021-22","books":["John"]}]'`),
      (e) => e.code === '23514',
    )
    await db.exec(
      `update pathfinders set levels='[{"name":"Friend","outcome":"incomplete","year":"2023-24"}]' where id=1`,
    )
    await assert.rejects(
      db.exec('update current_data set school_year=null where pathfinder_id=1'),
      (e) => e.code === '23502',
    )
    await assert.rejects(
      db.exec('select * from private.member_revision_backup'),
      (e) => e.code === '42501',
    )

    // Inclusive bubbles, constrained within the matching year and ANDed across categories.
    const inclusive = (
      await db.query(`select id from member_search where
 (levels @> '[{"name":"Friend","outcome":"basic","year":"2023-24"}]' or levels @> '[{"name":"Friend","outcome":"incomplete","year":"2023-24"}]')
 and (search_activity_details @> '[{"name":"TLT","year":"2023-24","detail":"Teaching"}]' or search_activity_details @> '[{"name":"Drums","year":"2023-24","detail":"Bass"}]')
 and search_event_details @> '[{"name":"Burning Twine","year":"2023-24","detail":"1st Place"}]'`)
    ).rows
    assert.deepEqual(inclusive, [{ id: 1 }])
    assert.equal(
      (
        await db.query(
          `select id from member_search where search_event_details @> '[{"name":"Burning Twine","year":"2024-25","detail":"1st Place"}]'`,
        )
      ).rows.length,
      0,
    )
    // Add Record creates both rows, leaves history empty, and retries safely.
    const request = '10000000-0000-0000-0000-000000000001'
    const create = (key, first, status, title, year = '2026-27') =>
      db.query('select public.add_member_record($1,$2,$3,$4,$5,$6,$7) as id', [
        key,
        first,
        ' Example ',
        '2001-02-03',
        status,
        title,
        year,
      ])
    const created = (
      await create(request, ' New ', 'staff', '["Club Director","Drill Instructor"]')
    ).rows[0].id
    assert.equal(
      (await create(request, ' New ', 'staff', '["Club Director","Drill Instructor"]')).rows[0].id,
      created,
    )
    const added = (await db.query('select * from member_search where id=$1', [created])).rows[0]
    assert.equal(added.first_name, 'New')
    assert.equal(added.last_name, 'Example')
    assert.equal(added.status, 'staff')
    assert.deepEqual(added.current_title, ['Club Director', 'Drill Instructor'])
    assert.deepEqual(added.current_activities, ['N/A'])
    assert.deepEqual(added.years_active, ['2026-27'])
    assert.deepEqual(added.levels, [])
    await assert.rejects(
      create(request, 'Changed', 'staff', '["Club Director"]'),
      (e) => e.code === '22023',
    )
    const before = (await db.query('select count(*) as n from pathfinders')).rows[0].n
    for (const [status, title, year] of [
      ['staff', '["Friend"]', '2026-27'],
      ['parent', '["Friend"]', '2026-27'],
      ['unknown', null, '2026-27'],
      ['pathfinder', '["Friend"]', '2025-26'],
    ]) {
      await assert.rejects(
        create('10000000-0000-0000-0000-000000000002', 'Rollback', status, title, year),
      )
      assert.equal((await db.query('select count(*) as n from pathfinders')).rows[0].n, before)
    }
    await assert.rejects(create('10000000-0000-0000-0000-000000000002', '   ', 'parent', null))
    await assert.rejects(
      create(
        '10000000-0000-0000-0000-000000000007',
        'Multiple',
        'pathfinder',
        '["Friend","Companion"]',
      ),
      (e) => e.code === '23514',
    )
    await assert.rejects(
      create('10000000-0000-0000-0000-000000000008', ' new ', 'parent', null),
      (e) => e.code === '23505' && /already exists/.test(e.message),
    )
    assert.equal((await db.query('select count(*) as n from pathfinders')).rows[0].n, before)
    for (const [index, status, title] of [
      [3, 'pathfinder', '["Friend"]'],
      [4, 'parent', null],
      [5, 'not_active', null],
    ]) {
      const id = (
        await create(`10000000-0000-0000-0000-00000000000${index}`, `Valid ${index}`, status, title)
      ).rows[0].id
      assert.equal(
        (await db.query('select status from current_data where pathfinder_id=$1', [id])).rows[0]
          .status,
        status,
      )
      assert.deepEqual(
        (await db.query('select years_active from pathfinders where id=$1', [id])).rows[0]
          .years_active,
        ['2026-27'],
      )
    }
    // Batch additions preserve earlier values and distinguish same-year details.
    const batch = async (ids, year, entry) =>
      (
        await db.query('select add_to_records($1,$2,$3) as result', [
          ids,
          year,
          JSON.stringify(entry),
        ])
      ).rows[0].result
    const staffId = created
    assert.equal(
      (await batch([1], '2023-24', { kind: 'event', event: 'Archery', placement: '1st Place' }))[0]
        .status,
      'error',
    )
    await assert.rejects(
      db.exec('select * from private.history_role_removal_backup'),
      (e) => e.code === '42501',
    )
    const pfId = (await db.query("select id from pathfinders where first_name='Valid 3'")).rows[0]
      .id
    let receipt = await batch([staffId, pfId], '2025-26', { kind: 'drums', details: ['Snare'] })
    assert.deepEqual(
      receipt.map((r) => r.status),
      ['added', 'added'],
    )
    receipt = await batch([staffId, pfId], '2025-26', { kind: 'drums', details: ['Snare', 'Bass'] })
    assert.ok(receipt.every((r) => r.status === 'added'))
    assert.deepEqual(
      (await db.query('select history from drum_corps where pathfinder_id=$1', [pfId])).rows[0]
        .history,
      [{ year: '2025-26', drums: ['Bass', 'Snare'] }],
    )
    assert.ok(
      (await batch([staffId, pfId], '2025-26', { kind: 'drums', details: ['Snare'] })).every(
        (r) => r.status === 'already',
      ),
    )
    assert.deepEqual(
      (await db.query('select years_active from pathfinders where id=$1', [pfId])).rows[0]
        .years_active,
      ['2026-27', '2025-26'],
    )
    receipt = await batch([staffId, pfId], '2024-25', {
      kind: 'staff',
      details: ['Drill Instructor'],
    })
    assert.equal(receipt.find((r) => r.id === staffId).status, 'added')
    assert.match(receipt.find((r) => r.id === pfId).reason, /Current Pathfinders/)
    assert.equal(
      (
        await db.query('select years_active from pathfinders where id=$1', [pfId])
      ).rows[0].years_active.includes('2024-25'),
      false,
    )
    receipt = await batch([pfId], '2024-25', { kind: 'drill', team: 'Adult' })
    assert.equal(receipt[0].status, 'added')
    for (const entry of [
      { kind: 'level', name: 'Friend', outcome: 'advanced' },
      { kind: 'drill', team: 'Precision' },
      { kind: 'pbe', details: ['Romans'] },
      { kind: 'tlt', details: ['Teaching'] },
    ]) {
      assert.equal((await batch([pfId], '2024-25', entry))[0].status, 'added')
      assert.equal((await batch([pfId], '2024-25', entry))[0].status, 'already')
    }
    assert.equal(
      (await batch([pfId], '2024-25', { kind: 'level', name: 'Friend', outcome: 'basic' }))[0]
        .status,
      'already',
    )
    assert.equal(
      (await batch([pfId], '2024-25', { kind: 'drill', team: 'Freestyle' }))[0].status,
      'added',
    )
    // Level identity ignores outcome/year, including migrated entries without a year.
    const priorLevels = (await db.query('select levels from pathfinders where id=$1', [pfId]))
      .rows[0].levels
    receipt = await batch([pfId], '2010-11', {
      kind: 'level',
      name: 'Friend',
      outcome: 'incomplete',
    })
    assert.equal(receipt[0].status, 'already')
    assert.equal(receipt[0].year_added, false)
    assert.deepEqual(
      (await db.query('select levels from pathfinders where id=$1', [pfId])).rows[0].levels,
      priorLevels,
    )
    assert.equal(
      (
        await db.query('select years_active from pathfinders where id=$1', [pfId])
      ).rows[0].years_active.includes('2010-11'),
      false,
    )
    assert.equal(
      (await batch([pfId], '2024-25', { kind: 'level', name: 'Companion', outcome: 'basic' }))[0]
        .status,
      'added',
    )
    // Team and instrument duplicates remain scoped to the year.
    assert.equal(
      (await batch([pfId], '2024-25', { kind: 'drill', team: 'Freestyle' }))[0].status,
      'already',
    )
    assert.equal(
      (await batch([pfId], '2023-24', { kind: 'drill', team: 'Freestyle' }))[0].status,
      'added',
    )
    assert.equal(
      (await batch([pfId], '2023-24', { kind: 'drums', details: ['Snare'] }))[0].status,
      'added',
    )
    // TLT removes already-earned operations across years, but adds missing operations.
    receipt = await batch([pfId], '2011-12', { kind: 'tlt', details: ['Teaching'] })
    assert.equal(receipt[0].status, 'already')
    assert.equal(receipt[0].year_added, false)
    receipt = await batch([staffId, pfId], '2022-23', {
      kind: 'tlt',
      details: ['Teaching', 'Outreach'],
    })
    assert.ok(receipt.every((r) => r.status === 'added'))
    assert.match(receipt.find((r) => r.id === pfId).reason, /Teaching/)
    assert.deepEqual(
      (await db.query('select history from tlt where pathfinder_id=$1', [pfId])).rows[0].history,
      [
        { year: '2022-23', operations: ['Outreach'] },
        { year: '2024-25', operations: ['Teaching'] },
      ],
    )
    assert.deepEqual(
      (await db.query('select history from tlt where pathfinder_id=$1', [staffId])).rows[0].history,
      [{ year: '2022-23', operations: ['Outreach', 'Teaching'] }],
    )
    assert.equal(
      (await batch([pfId], '2022-23', { kind: 'tlt', details: ['Teaching', 'Outreach'] }))[0]
        .status,
      'already',
    )
    const eventEntry = { kind: 'event', event: 'Archery', placement: '1st Place' }
    assert.equal((await batch([pfId], '2022-23', eventEntry))[0].status, 'added')
    receipt = await batch([staffId, pfId], '2022-23', { ...eventEntry, placement: '2nd Place' })
    assert.equal(receipt.find((r) => r.id === staffId).status, 'added')
    assert.equal(receipt.find((r) => r.id === pfId).status, 'error')
    assert.equal(
      (await db.query('select placement from red_zone_archery where pathfinder_id=$1', [pfId]))
        .rows[0].placement,
      '1st Place',
    )
    assert.equal(
      (
        await batch([pfId], '2022-23', {
          kind: 'event',
          event: 'Bible Events',
          name: 'Memory',
          placement: 'Participation',
        })
      )[0].status,
      'added',
    )
    assert.deepEqual(
      (await db.query('select history from pbe where pathfinder_id=$1', [pfId])).rows[0].history,
      [{ year: '2024-25', books: ['1 Corinthians', '2 Corinthians', 'Romans'] }],
    )
    for (const region of ['State', 'Union', 'Divisional']) {
      const invalidProgression = await batch([pfId], '2024-25', {
        kind: 'pbe',
        results: { [region]: '1st Place' },
      })
      assert.match(invalidProgression[0].reason, /requires placements for all earlier regions/)
    }
    const pbeResult = { kind: 'pbe', results: { Area: '1st Place', State: 'Participation' } }
    assert.equal((await batch([pfId], '2024-25', pbeResult))[0].status, 'added')
    assert.equal((await batch([pfId], '2024-25', pbeResult))[0].status, 'already')
    assert.equal(
      (
        await batch([pfId], '2024-25', {
          kind: 'pbe',
          results: { Union: '2nd Place', Divisional: '3rd Place' },
        })
      )[0].status,
      'added',
    )
    assert.equal((await batch([pfId], '2024-25', { kind: 'pbe' }))[0].status, 'already')
    const savedPbe = (await db.query('select history from pbe where pathfinder_id=$1', [pfId]))
      .rows[0].history
    assert.deepEqual(savedPbe[0].results, {
      Area: '1st Place',
      State: 'Participation',
      Union: '2nd Place',
      Divisional: '3rd Place',
    })
    assert.deepEqual(savedPbe[0].books, ['1 Corinthians', '2 Corinthians', 'Romans'])
    const pbeSearch = (
      await db.query('select search_activity_details from member_search where id=$1', [pfId])
    ).rows[0].search_activity_details
    assert.ok(
      pbeSearch.some(
        (r) => r.name === 'PBE' && r.year === '2024-25' && r.detail === 'State / Participation',
      ),
    )
    assert.ok(
      pbeSearch.some((r) => r.name === 'PBE' && r.year === 2025 && r.detail === 'Area / 1st Place'),
    )
    assert.ok(
      pbeSearch.some((r) => r.name === 'PBE' && r.year === '2024-25' && r.detail === 'Union'),
    )
    assert.ok(
      !pbeSearch.some(
        (r) => r.name === 'PBE' && r.year === '2024-25' && r.detail === 'State / 1st Place',
      ),
    )
    assert.ok(
      !pbeSearch.some(
        (r) => r.name === 'PBE' && r.year === '2023-24' && r.detail === 'State / Participation',
      ),
    )

    receipt = await batch([staffId, pfId], '2024-25', {
      kind: 'pbe',
      results: { Area: '3rd Place' },
    })
    assert.equal(receipt.find((r) => r.id === staffId).status, 'added')
    assert.match(receipt.find((r) => r.id === pfId).reason, /different placement.*Area/)
    assert.deepEqual(
      (await db.query('select history from pbe where pathfinder_id=$1', [pfId])).rows[0].history,
      savedPbe,
    )
    assert.equal(
      (await batch([pfId], '2025-26', { kind: 'pbe', results: { Area: 'Participation' } }))[0]
        .status,
      'added',
    )
    assert.deepEqual(
      (await db.query('select history from pbe where pathfinder_id=$1', [pfId])).rows[0].history[0],
      savedPbe[0],
    )
    for (const invalid of [
      null,
      [],
      { Local: '1st Place' },
      { Area: '4th Place' },
      { Area: ['1st Place', '2nd Place'] },
      { Area: null },
    ]) {
      await assert.rejects(
        batch([pfId], '2024-25', { kind: 'pbe', results: invalid }),
        /valid placement/,
      )
      await assert.rejects(
        db.query('update pbe set history=$1 where pathfinder_id=$2', [
          JSON.stringify([{ ...savedPbe[0], results: invalid }]),
          pfId,
        ]),
        (e) => e.code === '23514',
      )
    }
    await assert.rejects(batch([pfId], '1900-01', { kind: 'pbe', details: [] }), /No Bible books/)
    assert.equal(
      (
        await db.query('select years_active from pathfinders where id=$1', [pfId])
      ).rows[0].years_active.includes('1900-01'),
      false,
    )
    const honorId = (await db.query("insert into honors(name) values('Test Honor') returning id"))
      .rows[0].id
    assert.equal(
      (await batch([pfId], '2020-21', { kind: 'honor', honor_id: honorId }))[0].status,
      'added',
    )
    await db.query("update pathfinders set years_active=years_active-'2020-21' where id=$1", [pfId])
    receipt = await batch([pfId], '2020-21', { kind: 'honor', honor_id: honorId })
    assert.equal(receipt[0].status, 'already')
    assert.equal(receipt[0].year_added, true)
    // Unknown years are null throughout history, never added to Years Active.
    const undatedEntries = [
      { kind: 'level', name: 'Navigator', outcome: 'basic' },
      { kind: 'staff', details: ['Club Director'] },
      { kind: 'drill', team: 'Precision' },
      { kind: 'drums', details: ['Tenor'] },
      { kind: 'tlt', details: ['Records'] },
      { kind: 'pbe', results: { Area: '1st Place' } },
      { kind: 'honor', honor_id: honorId },
      { kind: 'event', event: 'Archery', placement: 'Participation' },
      { kind: 'event', event: 'Bible Events', name: 'Unknown year event', placement: '1st Place' },
    ]
    const knownYears = (
      await db.query('select years_active from pathfinders where id=$1', [staffId])
    ).rows[0].years_active
    for (const entry of undatedEntries) {
      const addedUnknown = await batch([staffId], null, entry)
      assert.equal(addedUnknown[0].status, 'added', JSON.stringify(addedUnknown))
      assert.equal(addedUnknown[0].year_added, false)
      assert.equal(
        (await batch([staffId], null, entry))[0].status,
        'already',
        JSON.stringify(entry),
      )
    }
    assert.deepEqual(
      (await db.query('select years_active from pathfinders where id=$1', [staffId])).rows[0]
        .years_active,
      knownYears,
    )
    assert.ok(
      (await db.query('select levels from pathfinders where id=$1', [staffId])).rows[0].levels.some(
        (e) => e.name === 'Navigator' && e.year === null,
      ),
    )
    for (const table of ['staff_history', 'drum_corps', 'pbe', 'tlt'])
      assert.ok(
        (
          await db.query(`select history from ${table} where pathfinder_id=$1`, [staffId])
        ).rows[0].history.some((e) => e.year === null),
      )
    const unknownSearch = (await db.query('select * from member_search where id=$1', [staffId]))
      .rows[0]
    assert.ok(unknownSearch.search_activities.includes('PBE'))
    assert.ok(unknownSearch.search_events.includes('Bible Events'))
    assert.ok(
      unknownSearch.search_activity_details.some(
        (e) => e.name === 'PBE' && e.year === null && e.detail === 'Area / 1st Place',
      ),
    )
    await assert.rejects(
      db.query("update pathfinders set years_active='[null]' where id=$1", [staffId]),
      (e) => e.code === '23514',
    )
    await assert.rejects(
      db.query('insert into honors_earned(pathfinder_id,honor_id,year_earned) values($1,$2,null)', [
        staffId,
        honorId,
      ]),
      (e) => e.code === '23505',
    )
    // Ranking uses current Status and the highest-priority title, before names.
    await db.query(
      'update current_data set current_title=\'["Junior Staff","Club Director"]\' where pathfinder_id=$1',
      [staffId],
    )
    const ranked = (
      await db.query(
        'select id,sort_status,sort_title from member_search order by sort_status,sort_title,sort_last_name,sort_first_name,id',
      )
    ).rows
    assert.ok(ranked.findIndex((r) => r.id === pfId) < ranked.findIndex((r) => r.id === staffId))
    assert.equal(ranked.find((r) => r.id === staffId).sort_title, 1)
    // Profile edits commit together, preserve identities, and reject stale snapshots.
    const snapshot = async (id) =>
      (await db.query('select get_profile_for_edit($1) as profile', [id])).rows[0].profile
    const edit = (id, original, profile) =>
      db.query('select update_profile($1,$2::jsonb,$3::jsonb)', [
        id,
        JSON.stringify(original),
        JSON.stringify(profile),
      ])
    const beforeEdit = await snapshot(staffId)
    const edited = structuredClone(beforeEdit)
    edited.pathfinders[0].notes = 'First paragraph.\n\nSecond paragraph.'
    edited.pathfinders[0].first_name = 'Edited'
    edited.current_data[0].status = 'parent'
    edited.current_data[0].current_title = null
    edited.current_data[0].current_activities = []
    edited.drum_corps[0].history[0].drums = ['Quad']
    edited.red_zone_archery[0].placement = '3rd Place'
    await edit(staffId, beforeEdit, edited)
    const afterEdit = await snapshot(staffId)
    assert.equal(afterEdit.pathfinders[0].notes, edited.pathfinders[0].notes)
    assert.equal(afterEdit.current_data[0].status, 'parent')
    assert.deepEqual(afterEdit.drum_corps[0].history[0].drums, ['Quad'])
    assert.equal(afterEdit.red_zone_archery[0].placement, '3rd Place')
    assert.equal(afterEdit.drum_corps[0].id, beforeEdit.drum_corps[0].id)
    assert.deepEqual(afterEdit.honors_earned, beforeEdit.honors_earned)
    await assert.rejects(edit(staffId, beforeEdit, edited), (e) => e.code === '40001')
    const invalidEdit = structuredClone(afterEdit)
    invalidEdit.pathfinders[0].notes = 'Must roll back'
    invalidEdit.tlt[0].history[0].operations = ['Invalid operation']
    await assert.rejects(edit(staffId, afterEdit, invalidEdit))
    assert.deepEqual(await snapshot(staffId), afterEdit)
    const moved = structuredClone(afterEdit)
    moved.drum_corps[0].pathfinder_id = pfId
    await assert.rejects(edit(staffId, afterEdit, moved), /Only profile fields/)
    const removed = structuredClone(afterEdit)
    removed.pathfinders = []
    await assert.rejects(edit(staffId, afterEdit, removed), /cannot be removed/)
    const forged = structuredClone(afterEdit)
    forged.pathfinders[0].id = pfId
    await assert.rejects(edit(staffId, afterEdit, forged), /identities/)
    // New history rows and JSON entries share the same atomic save.
    const additions = structuredClone(afterEdit)
    additions.red_zone_tents.push({ year: '2010-11', placement: 'Participation' })
    additions.honors_earned.push({ honor_id: honorId, year_earned: '2010-11' })
    additions.drill.push({ team: 'Precision', years: ['2010-11'] })
    additions.drum_corps[0].history.push({ year: '2010-11', drums: ['Bass'] })
    additions.pbe[0].history.push({ year: '2012-13', books: ['Fabricated Book'], results: {} })
    await edit(staffId, afterEdit, additions)
    const afterAdd = await snapshot(staffId)
    assert.ok(afterAdd.red_zone_tents.some((r) => r.year === '2010-11'))
    assert.ok(afterAdd.honors_earned.some((r) => r.year_earned === '2010-11'))
    assert.ok(afterAdd.drill.find((r) => r.team === 'Precision').years.includes('2010-11'))
    assert.equal(afterAdd.drill.filter((r) => r.team === 'Precision').length, 1)
    assert.deepEqual(afterAdd.pbe[0].history.find((r) => r.year === '2012-13').books, [
      '1 Thessalonians',
      '2 Thessalonians',
      'Acts',
    ])
    const invalidAddition = structuredClone(afterAdd)
    invalidAddition.red_zone_tents.push({ year: '2011-12', placement: 'Invalid' })
    invalidAddition.honors_earned.push({ honor_id: honorId, year_earned: '2011-12' })
    await assert.rejects(edit(staffId, afterAdd, invalidAddition))
    assert.deepEqual(await snapshot(staffId), afterAdd)
    const injected = structuredClone(afterAdd)
    injected.red_zone_tents.push({
      pathfinder_id: pfId,
      year: '2011-12',
      placement: 'Participation',
    })
    await assert.rejects(edit(staffId, afterAdd, injected), /Only profile fields/)
    // Empty history sections can create their first stored row.
    const freshId = (
      await create('10000000-0000-0000-0000-000000000090', 'New Editor', 'parent', null)
    ).rows[0].id
    const freshOriginal = await snapshot(freshId)
    const fresh = structuredClone(freshOriginal)
    fresh.staff_history.push({ history: [{ year: '2020-21', titles: ['Club Director'] }] })
    fresh.drum_corps.push({ history: [{ year: '2020-21', drums: ['Snare'] }] })
    fresh.pbe.push({
      history: [{ year: null, books: ['Ignored'], results: { Area: '1st Place' } }],
    })
    fresh.tlt.push({ history: [{ year: '2020-21', operations: ['Teaching'] }] })
    await edit(freshId, freshOriginal, fresh)
    const freshSaved = await snapshot(freshId)
    assert.equal(freshSaved.staff_history.length, 1)
    assert.equal(freshSaved.drum_corps.length, 1)
    assert.deepEqual(freshSaved.pbe[0].history[0].books, [])
    assert.equal(freshSaved.tlt.length, 1)
    const deletionOriginal = await snapshot(staffId)
    const missingRegistration = structuredClone(deletionOriginal)
    missingRegistration.current_data = []
    await assert.rejects(
      edit(staffId, deletionOriginal, missingRegistration),
      /Current Registration/,
    )
    assert.deepEqual(await snapshot(staffId), deletionOriginal)
    const deletion = structuredClone(deletionOriginal)
    for (const table of Object.keys(deletion))
      if (!['pathfinders', 'current_data'].includes(table)) deletion[table] = []
    const failedDeletion = structuredClone(deletion)
    failedDeletion.pathfinders[0].first_name = ''
    await assert.rejects(edit(staffId, deletionOriginal, failedDeletion))
    assert.deepEqual(await snapshot(staffId), deletionOriginal)
    await edit(staffId, deletionOriginal, deletion)
    const deleted = await snapshot(staffId)
    for (const table of Object.keys(deleted))
      if (!['pathfinders', 'current_data'].includes(table))
        assert.deepEqual(deleted[table], [], table)
    assert.equal(deleted.pathfinders[0].id, staffId)
    assert.deepEqual(deleted.current_data, deletionOriginal.current_data)
    assert.equal((await snapshot(freshId)).drum_corps.length, 1)
    await assert.rejects(
      db.query('delete from drum_corps where pathfinder_id=$1', [freshId]),
      (e) => e.code === '42501',
    )
    await assert.rejects(edit(staffId, deletionOriginal, deletion), (e) => e.code === '40001')
    await assert.rejects(
      db.query('delete from pathfinders where id=$1', [staffId]),
      (e) => e.code === '42501',
    )
    await db.exec("select set_config('request.jwt.claim.sub','',false)")
    await assert.rejects(
      db.query('delete from drum_corps where pathfinder_id=$1', [freshId]),
      (e) => e.code === '42501',
    )
    await assert.rejects(edit(freshId, freshSaved, freshSaved), (e) => e.code === '42501')
    await db.exec(
      "select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false)",
    )
    assert.equal((await snapshot(freshId)).drum_corps.length, 1)
    await db.exec('reset role; set role anon;')
    await assert.rejects(snapshot(staffId), (e) => e.code === '42501')
    await assert.rejects(edit(staffId, afterEdit, afterEdit), (e) => e.code === '42501')
    await assert.rejects(
      batch([pfId], '2025-26', { kind: 'drums', details: ['Snare'] }),
      (e) => e.code === '42501',
    )
    await assert.rejects(
      create('10000000-0000-0000-0000-000000000006', 'Denied', 'parent', null),
      (e) => e.code === '42501',
    )
    await assert.rejects(db.exec('select * from member_search'), (e) => e.code === '42501')
  } finally {
    await db.close()
  }
})
