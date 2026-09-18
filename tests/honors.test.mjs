import { readFile } from 'node:fs/promises'
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
