import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

test('honor catalog preserves earned references, separates editions, and validates metadata', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create table honors (
        id integer generated always as identity primary key,
        name text not null unique check (name = btrim(name) and length(name) between 1 and 200)
      );
      create table honors_earned (
        id integer generated always as identity primary key,
        honor_id integer not null references honors(id) on delete restrict,
        year_earned text
      );
      insert into honors(name) values ('Baking'), ('Scrapbooking'), ('Legacy Honor');
      insert into honors_earned(honor_id, year_earned) values (1, '2020-21'), (2, null);
    `)
    await db.exec(
      await readFile(
        new URL('../supabase/migrations/20260918000000_honors_columns.sql', import.meta.url),
        'utf8',
      ),
    )
    // Preparing the schema must leave catalog and earned rows unchanged.
    assert.equal((await db.query('select count(*)::int n from honors')).rows[0].n, 3)
    assert.equal((await db.query('select count(*)::int n from honors_earned')).rows[0].n, 2)
    await db.exec(
      await readFile(new URL('../supabase/catalogs/import-honors.sql', import.meta.url), 'utf8'),
    )
    const catalog = JSON.parse(
      await readFile(new URL('../supabase/catalogs/honors.json', import.meta.url), 'utf8'),
    ).honors
    assert.equal(catalog.length, 602)
    assert.equal(catalog.filter((h) => h.scope === 'Florida').length, 27)
    assert.equal((await db.query('select count(*)::int n from honors')).rows[0].n, 604)
    for (const honor of catalog) {
      const row = (await db.query('select * from honors where name=$1', [honor.name])).rows[0]
      assert.equal(row.category, honor.category)
      assert.equal(row.skill_level, honor.skill_level)
      assert.equal(row.year, honor.year)
    }
    assert.deepEqual((await db.query('select * from honors_earned order by id')).rows, [
      { id: 1, honor_id: 1, year_earned: '2020-21' },
      { id: 2, honor_id: 2, year_earned: null },
    ])
    assert.equal((await db.query("select id from honors where name='Baking'")).rows[0].id, 1)
    assert.deepEqual(
      (await db.query('select category, skill_level, year from honors where id=2')).rows,
      [{ category: null, skill_level: null, year: null }],
    )
    assert.deepEqual(
      (
        await db.query(
          "select name, year, skill_level from honors where name like 'Scrapbooking (%' order by name",
        )
      ).rows,
      [
        { name: 'Scrapbooking (2004)', year: 2004, skill_level: 1 },
        { name: 'Scrapbooking (Unknown)', year: null, skill_level: 2 },
      ],
    )
    for (const value of [0, 4, -1]) {
      await assert.rejects(db.query('update honors set skill_level=$1 where id=1', [value]))
    }
    for (const category of ['', ' Nature ']) {
      await assert.rejects(db.query('update honors set category=$1 where id=1', [category]))
    }
    await assert.rejects(db.query("insert into honors(name) values ('Baking')"))
    await assert.rejects(db.query('delete from honors where id=1'))
    await db.exec('update honors set year=1800, skill_level=3 where id=1')
    await db.exec('update honors set year=2100, skill_level=1 where id=1')
    await db.exec('update honors set year=null, skill_level=null where id=1')
  } finally {
    await db.close()
  }
})

test('integrated catalog, eligibility, search, and earned awards respect identity and permissions', async () => {
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
      const sql = await readFile(new URL(file, folder), 'utf8')
      if (!/^begin;/m.test(sql)) await db.exec('begin')
      await db.exec(sql)
      if (!/^begin;/m.test(sql)) await db.exec('commit')
    }
    assert.equal((await db.query('select count(*)::int n from honors')).rows[0].n, 617)
    assert.equal((await db.query('select count(*)::int n from master_awards')).rows[0].n, 15)
    assert.equal(
      (await db.query('select count(*)::int n from master_award_honors where honor_id is null'))
        .rows[0].n,
      16,
    )
    assert.deepEqual(
      (await db.query('select distinct category from honors order by category')).rows.map(
        (r) => r.category,
      ),
      [
        'Arts & Crafts',
        'Florida',
        'Health & Science',
        'Household Arts',
        'Master Award',
        'Nature',
        'Outdoor Industries',
        'Outreach',
        'Recreation',
        'Vocational',
      ],
    )
    await db.exec(`
      insert into pathfinders(first_name,last_name) values ('Honor','Example'), ('Health','Example'), ('NAD','Example');
      insert into current_data(pathfinder_id,status) values (1,'not_active'),(2,'not_active'),(3,'not_active');
      set role authenticated;
      select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
    `)
    const idFor = async (name) =>
      (await db.query('select id from honors where name=$1', [name])).rows[0].id
    const aquatic = await idFor('Aquatic Master Award')
    const health = await idFor('Health Master Award')
    const seven = [
      'Canoeing',
      'Kayaking',
      'Navigation',
      'Power Boating',
      'Rowing',
      'Sailing',
      'Scuba Diving',
    ]
    const ids = await Promise.all(seven.map(idFor))
    const add = async (person, honor, year = '2023-24') => {
      const result = await db.query('select add_to_records($1,$2,$3) result', [
        [person],
        year,
        { kind: 'honor', honor_id: honor },
      ])
      assert.equal(result.rows[0].result[0].status, 'added')
    }
    const awards = async (person = 1) =>
      (await db.query('select * from get_master_award_status($1)', [person])).rows
    // Club-approved NAD equivalents retain their regional source provenance.
    const source = JSON.parse(
      await readFile(new URL('../supabase/catalogs/honors.json', import.meta.url), 'utf8'),
    )
    let counterpartReferences = 0
    for (const award of source.master_awards) {
      for (const [index, group] of award.requirement_groups.entries()) {
        for (const honor of group.honors.filter((h) => h.mapping_basis)) {
          counterpartReferences++
          const result = await db.query(
            `
            select h.name, r.source_year, r.mapping_status
            from master_award_honors r join master_award_groups g on g.id=r.group_id
            join honors a on a.id=g.award_id join honors h on h.id=r.honor_id
            where a.name=$1 and g.sort_order=$2 and r.source_url=$3`,
            [award.name, index + 1, honor.source_url],
          )
          assert.deepEqual(result.rows, [
            {
              name: honor.catalog_name,
              source_year: honor.source_year,
              mapping_status: 'matched',
            },
          ])
        }
      }
    }
    assert.equal(counterpartReferences, 15)
    // Health and Healing's GC reference now accepts the recorded NAD honor.
    for (const name of [
      'Child Care',
      'Home Nursing',
      'Basic Rescue',
      'CPR',
      'Chemistry',
      'Physics',
    ])
      await add(3, await idFor(name))
    await add(3, await idFor('Child Care'), '2024-25')
    assert.equal(
      (await awards(3)).some((a) => a.honor_id === health),
      false,
    )
    await add(3, await idFor('Health and Healing'))
    assert.equal((await awards(3)).find((a) => a.honor_id === health).eligible, true)
    // GC and SAD Snowshoeing variants point to one NAD identity, not two credits.
    const snowshoeing = (
      await db.query(`
      select count(*)::int references, count(distinct honor_id)::int credits
      from master_award_honors where source_url in (
        'https://wiki.pathfindersonline.org/w/AY_Honors/Snowshoeing_-_Advanced_(GC)',
        'https://wiki.pathfindersonline.org/w/AY_Honors/Snowshoeing_-_Advanced_(SAD)'
      )`)
    ).rows[0]
    assert.deepEqual(snowshoeing, { references: 2, credits: 1 })
    for (const id of ids.slice(0, 6)) await add(1, id)
    await add(1, ids[0], '2024-25')
    assert.equal(
      (await awards()).some((a) => a.honor_id === aquatic),
      false,
    )
    await add(1, ids[6], null)
    assert.deepEqual(
      (await awards()).find((a) => a.honor_id === aquatic),
      {
        honor_id: aquatic,
        name: 'Aquatic Master Award',
        earned_years: [],
        eligible: true,
      },
    )
    assert.equal(
      (await db.query('select count(*)::int n from honors_earned where honor_id=$1', [aquatic]))
        .rows[0].n,
      0,
    )
    // Calendar/season filters match this honor's completion, never a different honor's year.
    const search = (await db.query('select search_honors from member_search where id=1')).rows[0]
    assert.ok(search.search_honors.some((h) => h.honor_id === ids[0] && h.year === '2024-25'))
    assert.ok(search.search_honors.some((h) => h.honor_id === ids[6] && h.year === null))
    assert.equal(
      (
        await db.query('select count(*)::int n from member_search where search_honors @> $1', [
          JSON.stringify([{ honor_id: ids[6], year: '2024-25' }]),
        ])
      ).rows[0].n,
      0,
    )
    await add(1, aquatic)
    assert.deepEqual(
      (await awards()).find((a) => a.honor_id === aquatic),
      {
        honor_id: aquatic,
        name: 'Aquatic Master Award',
        earned_years: ['2023-24'],
        eligible: false,
      },
    )
    // Existing reviewed edit workflow can remove/re-add an award without new privileged RPCs.
    const original = (await db.query('select get_profile_for_edit(1) p')).rows[0].p
    const changed = structuredClone(original)
    changed.honors_earned = changed.honors_earned.filter((row) => row.honor_id !== aquatic)
    await db.query('select update_profile(1,$1,$2)', [original, changed])
    assert.equal((await awards()).find((a) => a.honor_id === aquatic).eligible, true)

    const healthGroups = (
      await db.query(
        `
      select g.sort_order,g.required_count,array_agg(distinct c.honor_id) ids
      from master_award_groups g join master_award_honors c on c.group_id=g.id
      where g.award_id=$1 and c.honor_id is not null group by g.sort_order,g.required_count
      order by g.sort_order`,
        [health],
      )
    ).rows
    // Seven honors overall is insufficient without the required 3/2/2 distribution.
    for (const id of healthGroups[1].ids) await add(2, id)
    assert.equal(
      (await awards(2)).some((a) => a.honor_id === health),
      false,
    )
    for (const group of [healthGroups[0], healthGroups[2]])
      for (const id of group.ids.slice(0, group.required_count)) await add(2, id)
    assert.equal((await awards(2)).find((a) => a.honor_id === health).eligible, true)

    const match = async (earned, groups) =>
      (await db.query('select master_award_requirements_met($1,$2) matched', [earned, groups]))
        .rows[0].matched
    // A greedy match would consume honor 1 in the broad group and miss this valid assignment.
    assert.equal(
      await match(
        [1, 2, 3, 4, 5, 6, 7],
        [
          { required_count: 6, honors: [1, 2, 3, 4, 5, 6, 7] },
          { required_count: 1, honors: [1] },
        ],
      ),
      true,
    )
    // Overlapping quotas cannot reuse two honors for three slots, even with seven overall.
    assert.equal(
      await match(
        [1, 2, 3, 4, 5, 6, 7],
        [
          { required_count: 2, honors: [1, 2] },
          { required_count: 1, honors: [1, 2] },
          { required_count: 4, honors: [3, 4, 5, 6, 7] },
        ],
      ),
      false,
    )
    assert.equal(
      await match([1, 1, 1, 1, 1, 1, 1], [{ required_count: 7, honors: [1, 2, 3, 4, 5, 6, 7] }]),
      false,
    )
    assert.equal(await match(ids, []), false)
    // Unmapped choices can never count. Pending/manual rules cannot manufacture eligibility.
    await assert.rejects(
      db.query('update master_awards set required_honor_count=7'),
      (e) => e.code === '42501',
    )
    await db.exec("select set_config('request.jwt.claim.sub','',false)")
    assert.deepEqual(await awards(), [])
    assert.equal((await db.query('select count(*)::int n from master_awards')).rows[0].n, 0)
    await db.exec('reset role; set role anon;')
    await assert.rejects(
      db.query('select * from get_master_award_status(1)'),
      (e) => e.code === '42501',
    )
    await assert.rejects(db.query('select * from master_award_honors'), (e) => e.code === '42501')
  } finally {
    await db.close()
  }
})
