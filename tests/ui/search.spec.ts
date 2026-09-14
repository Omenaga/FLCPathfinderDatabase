import { expect, test, type Page } from '@playwright/test'

const member = { id: 2, first_name: 'Justin', last_name: 'Wu', name: 'Justin Wu', status: 'staff', has_current_data: true, current_title: null, current_activities: ['Drill'],
 years_active: ['2023-24'], levels: [{name:'Friend',outcome:'basic',year:'2023-24'},{name:'Companion',outcome:'incomplete',year:null}], birth_date:'2000-01-02',notes:'Existing notes' }
const fixture = {...member,staff_history:{id:1,pathfinder_id:2,history:[{year:'2025-26',titles:['Friend Counselor','Drill Instructor']}]},
 drill:[{id:1,years:['2023-24'],team:'Precision',history_role:'pathfinder'},{id:2,years:['2025-26'],team:'Adult',history_role:'staff'}],
 drum_corps:[{history:[{year:'2023-24',drums:['Snare']}],history_role:'pathfinder'}],
 pbe:[{history:[{year:'2021-22',books:['1 Kings','Ruth']}],history_role:'pathfinder'}],
 tlt:[{history:[{year:'2023-24',operations:['Teaching']}],history_role:'pathfinder'}],
 red_zone_drill_performance:[],red_zone_drum_performance:[],red_zone_honor_evaluations:[],red_zone_bible_events:[],red_zone_knots:[],red_zone_tents:[],red_zone_jump_rope:[],red_zone_archery:[],red_zone_lashing:[],
 red_zone_burning_twine:[{year:'2023-24',placement:'1st Place',history_role:'pathfinder'}]}
async function setup(page:Page) {
 const user={id:'00000000-0000-0000-0000-000000000001',email:'staff@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}
 await page.route('http://127.0.0.1:54321/auth/v1/**',route=>route.fulfill({json:{access_token:'test-token',refresh_token:'test-refresh',token_type:'bearer',expires_in:3600,user}}))
 await page.route('http://127.0.0.1:54321/rest/v1/member_search?**',route=>route.fulfill({json:[member],headers:{'access-control-expose-headers':'content-range','content-range':'0-0/1'}}))
 await page.route('http://127.0.0.1:54321/rest/v1/pathfinders?**',route=>route.fulfill({json:route.request().method()==='PATCH'?{id:2}:fixture}))
 await page.goto('/')
 await page.getByLabel('Email',{exact:true}).fill('staff@example.test')
 await page.getByLabel('Password',{exact:true}).fill('test-password')
 await page.getByRole('button',{name:'Sign in',exact:true}).click()
 await expect(page.getByRole('button',{name:'Open profile for Justin Wu'})).toBeVisible()
}

test('current results expose First Last Status Title and activities only',async({page})=>{
 await setup(page)
 await expect(page.getByRole('columnheader')).toHaveText(['First Name','Last Name','Status','Class/Titles','Current activities'])
 await expect(page.getByRole('row').last()).toContainText('Staff')
 await expect(page.getByRole('row').last()).toContainText('Not recorded')
 await expect(page.getByRole('row').last().getByRole('cell').last()).toHaveText('N/A')
 const status=page.getByRole('combobox',{name:'Status',exact:true})
 await expect(status.locator('option')).toHaveText(['Any','Pathfinder','Staff','Parent','Not Active'])
 const request=page.waitForRequest(r=>r.url().includes('status=eq.not_active'))
 await status.selectOption('Not Active')
 await page.getByRole('button',{name:'Search records'}).click()
 await request
})

test('role histories retain year detail links and nested honors focus',async({page})=>{
 await setup(page)
 await page.getByRole('button',{name:'Open profile for Justin Wu'}).click()
 const profile=page.getByRole('dialog',{name:'Member profile'})
 await expect(profile).toContainText('01/02/2000')
 const pf=profile.getByRole('region',{name:'Pathfinder history'})
 const staff=profile.getByRole('region',{name:'Staff history'})
 await expect(pf).toContainText('Friend (Basic)')
 await expect(pf).toContainText('Companion (Incomplete)')
 await expect(pf).toContainText('Year unknown')
 await expect(pf).toContainText('Precision')
 await expect(pf).not.toContainText('Adult')
 await expect(staff).toContainText('Adult')
 await expect(staff).toContainText('Friend Counselor, Drill Instructor')
 await profile.getByRole('button',{name:'View Honors'}).click()
 await expect(page.getByRole('dialog',{name:'Honors',exact:true})).toContainText('WIP')
 await page.keyboard.press('Escape')
 await expect(profile.getByRole('button',{name:'View Honors'})).toBeFocused()
 await page.keyboard.press('Escape')
 await expect(page.getByRole('button',{name:'Open profile for Justin Wu'})).toBeFocused()
})

test('Notes preserve paragraphs and report saves and failures',async({page})=>{
 await setup(page)
 await page.getByRole('button',{name:'Open profile for Justin Wu'}).click()
 const notes=page.getByLabel('Notes',{exact:true})
 await expect(notes).toHaveValue('Existing notes')
 await notes.fill('First sentence.\n\nSecond paragraph.')
 const request=page.waitForRequest(r=>r.method()==='PATCH')
 await page.getByRole('button',{name:'Save Notes'}).click()
 expect((await request).postDataJSON()).toEqual({notes:'First sentence.\n\nSecond paragraph.'})
 await expect(page.getByText('Notes saved',{exact:true})).toBeVisible()
 await page.route('**/rest/v1/pathfinders?**',route=>route.fulfill({status:500,json:{message:'Save unavailable'}}))
 await notes.fill('Keep this unsaved text')
 await page.getByRole('button',{name:'Save Notes'}).click()
 await expect(page.getByRole('alert')).toContainText('Save unavailable')
 await expect(notes).toHaveValue('Keep this unsaved text')
})

test('shared years constrain every category with OR bubbles and AND categories',async({page})=>{
 await setup(page)
 const years=page.getByRole('combobox',{name:'Years',exact:true})
 await years.fill('2023-24'); await years.press('Enter')
 const level=page.getByRole('combobox',{name:'Level Earned',exact:true})
 await level.fill('Friend')
 await expect(page.getByRole('option',{name:'Friend (2023-24)',exact:true})).toHaveCount(0)
 await page.getByRole('option',{name:'Friend / Basic',exact:true}).click()
 await level.fill('Friend / Advanced');await level.press('Enter')
 const activity=page.getByRole('combobox',{name:'Extracurricular',exact:true})
 await activity.fill('Drums / Snare');await activity.press('Enter')
 await activity.fill('TLT / Teaching');await activity.press('Enter')
 const event=page.getByRole('combobox',{name:'Red Zone Events',exact:true})
 await event.fill('Burning Twine / 1st Place');await event.press('Enter');await event.press('Escape')
 const request=page.waitForRequest(r=>r.url().includes('or='))
 await page.getByRole('button',{name:'Search records'}).click()
 const expression=new URL((await request).url()).searchParams.get('or')!
 expect(expression).toContain('(and(or(levels.cs.')
 expect(expression).toContain('),or(search_activity_details.cs.')
 expect(expression).toContain('),or(search_event_details.cs.')
 const decoded=expression.replaceAll('\\"','"')
 expect(decoded).toContain('"outcome":"basic","year":"2023-24"')
 expect(decoded).toContain('"outcome":"advanced","year":"2023-24"')
 expect(decoded).toContain('"name":"Drums","detail":"Snare","year":"2023-24"')
 expect(decoded).toContain('"name":"TLT","detail":"Teaching","year":"2023-24"')
 expect(decoded).toContain('"name":"Burning Twine","detail":"1st Place","year":"2023-24"')
 expect(expression).not.toContain('search_years')
 await page.getByRole('button',{name:'Clear filters'}).click()
 await expect(page.getByRole('button',{name:/^Remove /})).toHaveCount(0)
})

test('profile handles missing data and retries failed loads',async({page})=>{
 await setup(page)
 let attempts=0
 await page.route('**/rest/v1/pathfinders?**',route=>{
 expect(new URL(route.request().url()).searchParams.get('select')).not.toContain('honors')
 attempts++
 return attempts===1?route.fulfill({status:500,json:{message:'Profile unavailable'}}):route.fulfill({json:{...fixture,levels:[],years_active:[],staff_history:null,birth_date:null}})
 })
 await page.getByRole('button',{name:'Open profile for Justin Wu'}).click()
 await expect(page.getByRole('alert')).toContainText('Profile unavailable')
 await page.getByRole('button',{name:'Try again'}).click()
 await expect(page.getByText('No levels recorded',{exact:true})).toBeVisible()
 await expect(page.getByText('No staff years or titles recorded',{exact:true})).toBeVisible()
})

test('profile remains scrollable on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844})
 await setup(page)
 await page.getByRole('button',{name:'Open profile for Justin Wu'}).click()
 const dialog=page.getByRole('dialog',{name:'Member profile'})
 await expect(dialog.getByText('Friend (Basic)',{exact:false})).toBeVisible()
 const box=await dialog.boundingBox()
 expect(box!.width).toBeLessThanOrEqual(390)
 await page.screenshot({path:'test-results/profile-mobile.png'})
 await page.setViewportSize({width:1440,height:1000})
 await page.screenshot({path:'test-results/profile-desktop.png'})
})


test('group headings and outer areas replace Any without swallowing detail clicks',async({page})=>{
 await setup(page)
 const input=page.getByRole('combobox',{name:'Extracurricular',exact:true})
 await input.fill('Drums')
 await expect(page.getByRole('listbox',{name:'Extracurricular options'}).getByRole('option',{name:'Any',exact:true})).toHaveCount(0)
 await page.getByRole('option',{name:'Drums / Snare',exact:true}).click()
 await expect(page.getByRole('button',{name:'Remove Drums from Extracurricular',exact:true})).toHaveCount(0)
 await input.fill('Drums')
 await page.getByRole('option',{name:'Drums',exact:true}).click()
 await expect(page.getByRole('button',{name:'Remove Drums from Extracurricular',exact:true})).toBeVisible()
 const level=page.getByRole('combobox',{name:'Level Earned',exact:true})
 await level.fill('Friend'); await level.press('Enter')
 await expect(page.getByRole('button',{name:'Remove Friend from Level Earned',exact:true})).toBeVisible()
 const event=page.getByRole('combobox',{name:'Red Zone Events',exact:true})
 await event.fill('Archery')
 await page.getByRole('group',{name:'Archery',exact:true}).locator('..').click({position:{x:2,y:2}})
 await expect(page.getByRole('button',{name:'Remove Archery from Red Zone Events',exact:true})).toBeVisible()
})
