import { expect, test, type Page } from '@playwright/test'

const fixture = {
  id: 42, name: 'Synthetic Pathfinder', has_current_data: true, status: 'returning', grade: 7, class_level: 'Explorer', current_activities: ['Drums'], years_active: ['2024-2025', '2025-2026'],
  levels: [{ name: 'Friend', advanced: true }], extracurriculars: ['Drill', 'Drums', 'PBE', 'TLT'],
  red_zone_participation: ['Archery', 'Knots Relay'],
  drill: { pathfinder_id: 42, years: ['2024-2025'] },
  drum_corps: [{ years: ['2024-2025'], drum_played: 'Snare' }, { years: ['2025-2026'], drum_played: 'Bass' }],
  pbe: [{ years: ['2024-2025'], bible_book: 'Exodus' }], tlt: [{ years: ['2025-2026'], tlt_operation: 'Teaching' }],
  honors_earned: [{ year_earned: 2025, honors: { name: 'Synthetic Honor' } }],
  red_zone_archery: [{ year: 2024, placement: '1st Place' }, { year: 2025, placement: '2nd Place' }],
  red_zone_knots: [], red_zone_drill_performance: [], red_zone_drum_performance: [],
  red_zone_honor_evaluations: [], red_zone_bible_events: [], red_zone_tents: [], red_zone_jump_rope: [],
  red_zone_lashing: [], red_zone_burning_twine: [],
}

async function setup(page: Page) {
  const user = { id: '00000000-0000-0000-0000-000000000001', email: 'staff@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
  await page.route('http://127.0.0.1:54321/auth/v1/**', async route => {
    await route.fulfill({ json: { access_token: 'test-session-token', refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user } })
  })
  await page.route('http://127.0.0.1:54321/rest/v1/member_search?**', route => {
    const details = new URL(route.request().url()).searchParams.get('id') === 'eq.42'
    return route.fulfill({ json: details ? fixture : [fixture], headers: { 'access-control-expose-headers': 'content-range', 'content-range': '0-0/1' } })
  })
  await page.goto('/')
  await page.getByLabel('Email', { exact: true }).fill('staff@example.test')
  await page.getByLabel('Password', { exact: true }).fill('test-only-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test('combines historical filters and opens the WIP profile', async ({ page }) => {
  await setup(page)
  await expect(page.getByRole('button', { name: 'Synthetic Pathfinder' })).toBeVisible()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic')
  await page.getByLabel('Years Active', { exact: true }).fill('2024')
  await page.getByLabel('Years Active', { exact: true }).press('Enter')
  await page.getByLabel('Level Earned', { exact: true }).fill('Friend (Advanced)')
  await page.getByLabel('Level Earned', { exact: true }).press('Enter')
  await page.getByRole('combobox', { name: 'Extracurricular', exact: true }).fill('Drums')
  await page.getByRole('combobox', { name: 'Extracurricular', exact: true }).press('Enter')
  await page.getByLabel('Red Zone Events', { exact: true }).fill('Archery')
  await page.getByLabel('Red Zone Events', { exact: true }).press('Enter')
  const request = page.waitForRequest(r => r.url().includes('/rest/v1/member_search?') && r.url().includes('levels='))
  await page.getByRole('button', { name: 'Search records' }).click()
  const params = new URL((await request).url()).searchParams
  expect(params.get('name')).toBe('ilike.%Synthetic%')
  expect(params.get('or')).toBe('(and(or(search_years.cs.["2023-2024"],search_years.cs.["2024-2025"])))')
  expect(params.get('levels')).toBe('cs.[{"name":"Friend","advanced":true}]')
  expect(params.get('search_activities')).toBe('cs.["Drums"]')
  expect(params.get('red_zone_participation')).toBe('cs.["Archery"]')
  await page.getByRole('button', { name: 'Synthetic Pathfinder' }).click()
  const details = page.getByRole('dialog', { name: 'Member profile' })
  await expect(details.getByText('WIP', { exact: true })).toBeVisible()
  await expect(details).not.toContainText('Synthetic Pathfinder')
  await expect(details).not.toContainText('Snare')
  await page.keyboard.press('Escape')
  await expect(details).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Synthetic Pathfinder' })).toBeFocused()
  await page.getByRole('button', { name: 'Synthetic Pathfinder' }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible()
  await expect(page.getByText('Synthetic Pathfinder')).toHaveCount(0)
})

test('distinguishes an empty result from a database failure and retries', async ({ page }) => {
  await setup(page)
  await expect(page.getByRole('button', { name: 'Synthetic Pathfinder' })).toBeVisible()
  await page.route('http://127.0.0.1:54321/rest/v1/member_search?**', route => route.fulfill({ json: [], headers: { 'access-control-expose-headers': 'content-range', 'content-range': '*/0' } }))
  await page.getByRole('button', { name: 'Search records' }).click()
  await expect(page.getByText('No members found.', { exact: false })).toBeVisible()
  await page.route('http://127.0.0.1:54321/rest/v1/member_search?**', route => route.fulfill({ status: 400, json: { message: 'Test database failure' } }))
  await page.getByRole('button', { name: 'Search records' }).click()
  await expect(page.getByRole('alert')).toContainText('Test database failure')
  await page.route('http://127.0.0.1:54321/rest/v1/member_search?**', route => route.fulfill({ json: [fixture], headers: { 'access-control-expose-headers': 'content-range', 'content-range': '0-0/1' } }))
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('button', { name: 'Synthetic Pathfinder' })).toBeVisible()
})

test('an Auth account immediately reaches search without an approval RPC', async ({ page }) => {
  let approvalRequests = 0
  page.on('request', request => { if (request.url().includes('/rpc/current_staff_role')) approvalRequests++ })
  await setup(page)
  await expect(page.getByRole('button', { name: 'Synthetic Pathfinder' })).toBeVisible()
  expect(approvalRequests).toBe(0)
})

test('signed-out visitors see login and make no member requests', async ({ page }) => {
  let memberRequests = 0
  page.on('request', request => { if (request.url().includes('/rest/v1/member_search')) memberRequests++ })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible()
  expect(memberRequests).toBe(0)
})

test('paginates results using stable server-side ranges', async ({ page }) => {
  await setup(page)
  await expect(page.getByRole('button', { name: 'Synthetic Pathfinder' })).toBeVisible()
  await page.route('http://127.0.0.1:54321/rest/v1/member_search?**', route => {
    const offset = new URL(route.request().url()).searchParams.get('offset')
    return route.fulfill({ json: [{ ...fixture, id: offset === '25' ? 43 : 42, name: offset === '25' ? 'Second page member' : fixture.name }], headers: { 'access-control-expose-headers': 'content-range', 'content-range': `${offset === '25' ? '25-25' : '0-24'}/26` } })
  })
  await page.getByRole('button', { name: 'Search records' }).click()
  await expect(page.getByText('Page 1 of 2')).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Second page member' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
})


test('current results show N/A for inactive fields and retain historical-only members', async ({ page }) => {
  await setup(page)
  await page.route('http://127.0.0.1:54321/rest/v1/member_search?**', route => route.fulfill({
    json: [fixture, { ...fixture, id: 43, name: 'Inactive member', has_current_data: false, status: null },
      { ...fixture, id: 44, name: 'Graduated member', has_current_data: false, status: 'graduated' },
      { ...fixture, id: 45, name: 'Historical member', has_current_data: false, status: null, grade: null, class_level: null, current_activities: null }],
    headers: { 'access-control-expose-headers': 'content-range', 'content-range': '0-3/4' },
  }))
  await expect(page.getByRole('button', { name: 'Search records' })).toBeEnabled()
  await page.getByRole('button', { name: 'Search records' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Synthetic Pathfinder' })).toContainText('Returning')
  for (const name of ['Inactive member', 'Graduated member']) {
    const row = page.getByRole('row').filter({ hasText: name })
    await expect(row.getByRole('cell').nth(2)).toHaveText('N/A')
    await expect(row.getByRole('cell').nth(3)).toHaveText('N/A')
    await expect(row.getByRole('cell').nth(4)).toHaveText('N/A')
  }
  await expect(page.getByRole('row').filter({ hasText: 'Graduated member' })).toContainText('Graduated')
  await expect(page.getByRole('row').filter({ hasText: 'Inactive member' })).toContainText('Unregistered')
  await expect(page.getByRole('row').filter({ hasText: 'Historical member' })).toContainText('Unregistered')
  await expect(page.getByRole('columnheader', { name: 'Active years', exact: true })).toHaveCount(0)
})


test('status filter sends each effective status and clears with other filters', async ({ page }) => {
  await setup(page)
  for (const status of ['New', 'Returning', 'Graduated', 'Unregistered']) {
    await expect(page.getByRole('button', { name: 'Search records' })).toBeEnabled()
    await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption(status)
    const request = page.waitForRequest(r => r.url().includes('/rest/v1/member_search?') && new URL(r.url()).searchParams.get('status') === 'eq.' + status.toLowerCase())
    await page.getByRole('button', { name: 'Search records' }).click()
    await request
  }
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('')
})


test('multi-select filters combine every option and support typing, removal and reset', async ({ page }) => {
  await setup(page)
  const year = page.getByRole('combobox', { name: 'Years Active', exact: true })
  await year.focus()
  await expect(page.getByRole('option', { name: '2010', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: String(new Date().getFullYear()), exact: true })).toHaveCount(1)
  await expect(page.getByRole('option', { name: '2009', exact: true })).toHaveCount(0)
  for (const [label, values] of [
    ['Years Active', ['2024', '2025']], ['Level Earned', ['Friend', 'Companion (Advanced)']],
    ['Extracurricular', ['Drill', 'Drums']], ['Red Zone Events', ['Archery', 'Knots Relay']],
  ] as const) {
    const input = page.getByRole('combobox', { name: label, exact: true })
    for (const value of values) { await input.fill(value.toLowerCase()); await input.press('Enter') }
  }
  const request = page.waitForRequest(r => r.url().includes('/rest/v1/member_search?') && r.url().includes('levels='))
  await page.getByRole('button', { name: 'Search records' }).click()
  const params = new URL((await request).url()).searchParams
  expect(params.get('levels')).toBe('cs.[{"name":"Friend","advanced":false},{"name":"Companion","advanced":true}]')
  expect(params.get('search_activities')).toBe('cs.["Drill","Drums"]')
  expect(params.get('red_zone_participation')).toBe('cs.["Archery","Knots Relay"]')
  expect(params.get('or')).toBe('(and(or(search_years.cs.["2023-2024"],search_years.cs.["2024-2025"]),or(search_years.cs.["2024-2025"],search_years.cs.["2025-2026"])))')
  await page.getByRole('button', { name: 'Remove Friend from Level Earned', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove Friend from Level Earned', exact: true })).toHaveCount(0)
  await year.fill('bad year')
  await year.press('Enter')
  await expect(page.getByText('No matching options', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(year).toHaveValue('')
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0)
})


test('regular and Advanced versions are mutually exclusive and removal re-enables them', async ({ page }) => {
  await setup(page)
  const input = page.getByRole('combobox', { name: 'Level Earned', exact: true })
  await input.fill('Friend')
  await input.press('Enter')
  await input.fill('Friend (Advanced)')
  await expect(page.getByRole('option', { name: 'Friend (Advanced)', exact: true })).toHaveAttribute('aria-disabled', 'true')
  await input.press('Enter')
  await expect(page.getByRole('button', { name: 'Remove Friend (Advanced) from Level Earned', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Remove Friend from Level Earned', exact: true }).click()
  await input.focus()
  await input.press('Enter')
  await input.fill('Friend')
  await expect(page.getByRole('option', { name: 'Friend', exact: true })).toHaveAttribute('aria-disabled', 'true')
  await page.getByRole('option', { name: 'Friend', exact: true }).click({ force: true })
  await expect(page.getByRole('button', { name: 'Remove Friend from Level Earned', exact: true })).toHaveCount(0)
})
