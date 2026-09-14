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
 if(file==='20260915110000_current_season_default.sql') {
  // Reproduce the live schema drift and blank season that hid the Staff row.
  await db.exec('alter table current_data alter column school_year drop not null; alter table current_data drop constraint current_data_school_year_check; update current_data set school_year=null')
 }
 if(file==='20260915120000_staff_drum_history.sql') {
  await db.exec(`insert into staff_titles values ('Director'),('Deputy');
  insert into staff_history(pathfinder_id,years,title) values
   (1,'["2023-24","2024-25"]','Director'),(1,'["2023-24"]','Deputy'),(1,'["2022-23"]',null);
  insert into drum_corps(pathfinder_id,years,drum_played,history_role) values
   (1,'["2023-24","2024-25"]','Snare','pathfinder'),(1,'["2023-24"]','Bass','pathfinder'),(1,'["2025-26"]','Tenor','staff');`)
 }
 if(file==='20260915130000_current_title_json.sql') await db.exec(`update current_data set current_title='Club Director',current_activities='["Drill"]' where pathfinder_id=1`)
 const sql=await readFile(new URL(file,folder),'utf8')
 if(!/^begin;/m.test(sql)) await db.exec('begin')
 await db.exec(sql)
 if(!/^begin;/m.test(sql)) await db.exec('commit')
 }
 const row=(await db.query('select * from member_search where id=1')).rows[0]
 assert.equal((await db.query('select school_year from current_data where pathfinder_id=1')).rows[0].school_year,'2026-27')
 assert.deepEqual(row.current_title,['Club Director'])
 assert.deepEqual(row.current_activities,['N/A'])
 assert.equal(row.first_name,'Justin'); assert.equal(row.last_name,'Wu');assert.equal(row.status,'staff')
 assert.deepEqual(row.years_active,['2023-24'])
 assert.deepEqual(row.levels,[{name:'Friend',outcome:'advanced',year:null}])
 assert.ok(row.search_activity_years.includes('TLT (2023)'))
 assert.ok(row.search_event_years.includes('Burning Twine (2024)'))
 assert.ok(row.search_event_years.includes('Burning Twine (2023-24)'))
 assert.ok(row.search_activity_years.includes('TLT (2023-24)'))
 assert.ok(row.search_activity_details.some(r=>r.name==='TLT' && r.year==='2023-24' && r.detail==='Teaching'))
 assert.ok(row.search_event_details.some(r=>r.name==='Burning Twine' && r.year==='2023-24' && r.detail==='1st Place'))
 assert.deepEqual((await db.query('select history from staff_history where pathfinder_id=1')).rows[0].history,
  [{year:'2022-23',titles:[]},{year:'2023-24',titles:['Deputy','Director']},{year:'2024-25',titles:['Director']}])
 assert.deepEqual((await db.query("select history from drum_corps where pathfinder_id=1 and history_role='pathfinder'")).rows[0].history,
  [{year:'2023-24',drums:['Bass','Snare']},{year:'2024-25',drums:['Snare']}])
 assert.deepEqual((await db.query("select history from drum_corps where history_role='staff'")).rows[0].history,[{year:'2025-26',drums:['Tenor']}])
 assert.equal((await db.query("select count(*)::int as n from staff_titles where title in ('Club Director','Friend Counselor','Master Guide','Trailer')")).rows[0].n,4)
 assert.ok(row.search_years.includes('2022-23'))
 assert.ok(row.search_activity_details.some(r=>r.name==='Drums' && r.year==='2023-24' && r.detail==='Bass'))
 assert.ok(!row.search_activity_details.some(r=>r.name==='Drums' && r.year==='2024-25' && r.detail==='Bass'))
 assert.equal((await db.query('select count(*)::int as n from private.staff_drum_history_backup')).rows[0].n,6)
 await assert.rejects(db.exec("delete from staff_titles where title='Director'"),e=>e.code==='23503')
 await assert.rejects(db.exec("update staff_titles set title='Renamed' where title='Deputy'"),e=>e.code==='23503')
 for(const [table,key,invalid] of [['staff_history','titles','Unknown'],['drum_corps','drums','Piano']]) {
  for(const history of [[],[{year:'2023-25',[key]:[]}],[{year:'2023-24',[key]:[invalid]}],[{year:'2023-24',[key]:[]},{year:'2023-24',[key]:[]}],[{year:'2023-24',[key]:null}],[{year:'2023-24',[key]:[],extra:true}]]) {
   await assert.rejects(db.query(`update ${table} set history=$1 where pathfinder_id=1`,[JSON.stringify(history)]),e=>e.code==='23514')
  }
 }
 await db.exec("insert into staff_titles values ('Counselor')")
 assert.equal((await db.query('select history from pbe')).rows[0].history[0].year,'2021-22')
 assert.equal((await db.query('select year from red_zone_burning_twine')).rows[0].year,'2023-24')
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`)
 await db.exec(`update pathfinders set notes=E'One sentence.\nAnother paragraph.',birth_date='2000-01-02' where id=1;
 insert into drill(pathfinder_id,team,years,history_role) values (1,'Adult','["2025-26"]','staff');`)
 await assert.rejects(db.exec(`update current_data set current_title='["Friend"]' where pathfinder_id=1`),e=>e.code==='23514')
 await db.exec(`update current_data set current_title='["Counselor"]' where pathfinder_id=1`)
 await db.exec(`update staff_history set history=history || '[{"year":"2025-26","titles":["Counselor"]}]' where pathfinder_id=1`)
 await db.exec(`update current_data set current_title='["Club Director","Drill Instructor"]',current_activities='["Drums"]' where pathfinder_id=1`)
 assert.deepEqual((await db.query('select current_activities from current_data where pathfinder_id=1')).rows[0].current_activities,['N/A'])
 for(const title of ['"Club Director"','["Club Director","Club Director"]','["Unknown"]','{}','null']) {
  await assert.rejects(db.query('update current_data set current_title=$1 where pathfinder_id=1',[title]),e=>e.code==='23514')
 }
 await db.exec(`update current_data set status='pathfinder',current_title='["Friend"]' where pathfinder_id=1`)
 assert.deepEqual((await db.query('select current_activities from current_data where pathfinder_id=1')).rows[0].current_activities,[])
 await assert.rejects(db.exec(`update current_data set status='parent' where pathfinder_id=1`),e=>e.code==='23514')
 await assert.rejects(db.exec(`update pathfinders set years_active='["2023-25"]' where id=1`),e=>e.code==='23514')
 await assert.rejects(db.exec(`update pbe set history='[{"year":"2021-22","books":["John"]}]'`),e=>e.code==='23514')
 await db.exec(`update pathfinders set levels='[{"name":"Friend","outcome":"incomplete","year":"2023-24"}]' where id=1`)
 await assert.rejects(db.exec('update current_data set school_year=null where pathfinder_id=1'),e=>e.code==='23502')
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
