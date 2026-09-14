import {readFile,readdir} from 'node:fs/promises'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'

test('member revision preserves history and enforces roles, ranges and access',async()=>{
 const db=new PGlite()
 try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`)
 const folder=new URL('../supabase/migrations/',import.meta.url)
 for(const file of (await readdir(folder)).filter(f=>f.endsWith('.sql')).sort()) {
 if(file==='20260914000000_member_revision.sql') {
 await db.exec(`insert into pathfinders(name,years_active,levels) values ('Justin Wu','["2023-2024"]','[{"name":"Friend","advanced":true}]');
 insert into current_data(pathfinder_id,school_year,status,grade) values (1,'2026-2027','graduated',10);
 insert into drill values (1,'["2023-2024"]');
 insert into pbe(pathfinder_id,history) values (1,'[{"year":"2021-2022","books":["Ruth"]}]');
 insert into tlt(pathfinder_id,history) values (1,'[{"year":2024,"operations":["Teaching"]}]');
 insert into red_zone_burning_twine(pathfinder_id,year,placement) values (1,2024,'1st Place');`)
 }
 const sql=await readFile(new URL(file,folder),'utf8')
 if(!/^begin;/m.test(sql)) await db.exec('begin')
 await db.exec(sql)
 if(!/^begin;/m.test(sql)) await db.exec('commit')
 }
 const row=(await db.query('select * from member_search where id=1')).rows[0]
 assert.equal(row.first_name,'Justin'); assert.equal(row.last_name,'Wu');assert.equal(row.status,'staff')
 assert.deepEqual(row.years_active,['2023-24'])
 assert.deepEqual(row.levels,[{name:'Friend',outcome:'advanced',year:null}])
 assert.ok(row.search_activity_years.includes('TLT (2023)'))
 assert.ok(row.search_event_years.includes('Burning Twine (2024)'))
 assert.ok(row.search_event_years.includes('Burning Twine (2023-24)'))
 assert.ok(row.search_activity_years.includes('TLT (2023-24)'))
 assert.ok(row.search_activity_details.some(r=>r.name==='TLT' && r.year==='2023-24' && r.detail==='Teaching'))
 assert.ok(row.search_event_details.some(r=>r.name==='Burning Twine' && r.year==='2023-24' && r.detail==='1st Place'))
 await db.exec("insert into staff_titles values ('Counselor')")
 assert.equal((await db.query('select history from pbe')).rows[0].history[0].year,'2021-22')
 assert.equal((await db.query('select year from red_zone_burning_twine')).rows[0].year,'2023-24')
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`)
 await db.exec(`update pathfinders set notes=E'One sentence.\nAnother paragraph.',birth_date='2000-01-02' where id=1;
 insert into drill(pathfinder_id,team,years,history_role) values (1,'Adult','["2025-26"]','staff');`)
 await assert.rejects(db.exec(`update current_data set current_title='Friend' where pathfinder_id=1`),e=>e.code==='23514')
 await db.exec(`update current_data set current_title='Counselor' where pathfinder_id=1`)
 await db.exec(`insert into staff_history(pathfinder_id,years,title) values (1,'["2025-26"]','Counselor')`)
 await db.exec(`update current_data set status='pathfinder',current_title='Friend' where pathfinder_id=1`)
 await assert.rejects(db.exec(`update current_data set status='parent' where pathfinder_id=1`),e=>e.code==='23514')
 await assert.rejects(db.exec(`update pathfinders set years_active='["2023-25"]' where id=1`),e=>e.code==='23514')
 await assert.rejects(db.exec(`update pbe set history='[{"year":"2021-22","books":["John"]}]'`),e=>e.code==='23514')
 await db.exec(`update pathfinders set levels='[{"name":"Friend","outcome":"incomplete","year":"2023-24"}]' where id=1`)
 await assert.rejects(db.exec('select * from private.member_revision_backup'),e=>e.code==='42501')

 // Inclusive bubbles, constrained within the matching year and ANDed across categories.
 const inclusive=(await db.query(`select id from member_search where
 (levels @> '[{"name":"Friend","outcome":"basic","year":"2023-24"}]' or levels @> '[{"name":"Friend","outcome":"incomplete","year":"2023-24"}]')
 and (search_activity_details @> '[{"name":"TLT","year":"2023-24","detail":"Teaching"}]' or search_activity_details @> '[{"name":"Drums","year":"2023-24","detail":"Bass"}]')
 and search_event_details @> '[{"name":"Burning Twine","year":"2023-24","detail":"1st Place"}]'`)).rows
 assert.deepEqual(inclusive,[{id:1}])
 assert.equal((await db.query(`select id from member_search where search_event_details @> '[{"name":"Burning Twine","year":"2024-25","detail":"1st Place"}]'`)).rows.length,0)
 await db.exec('reset role; set role anon;')
 await assert.rejects(db.exec('select * from member_search'),e=>e.code==='42501')
 } finally {await db.close()}
})
