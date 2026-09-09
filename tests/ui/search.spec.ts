import { expect, test, type Page } from '@playwright/test'

const fixture = {
  id: 42, name: 'Synthetic Pathfinder', years_active: ['2024-2025', '2025-2026'],
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

async function setup(page: Page, role: string | null = 'viewer') {
  const user = { id: '00000000-0000-0000-0000-000000000001', email: 'staff@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
  await page.route('http://127.0.0.1:54321/auth/v1/**', async route => {
    await route.fulfill({ json: { access_token: 'test-session-token', refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user } })
  })
  await page.route('http://127.0.0.1:54321/rest/v1/rpc/current_staff_role', route => route.fulfill({ json: role }))
  await page.route('http://127.0.0.1:54321/rest/v1/pathfinders?**', route => {
    const details = new URL(route.request().url()).searchParams.get('id') === 'eq.42'
    return route.fulfill({ json: details ? fixture : [fixture], headers: { 'access-control-expose-headers': 'content-range', 'content-range': '0-0/1' } })
  })
  await page.goto('/')
  await page.getByLabel('Email', { exact: true }).fill('staff@example.test')
  await page.getByLabel('Password', { exact: true }).fill('test-only-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test('combines core filters and displays year-linked histories', async ({ page }) => {
  await setup(page)
  await expect(page.getByRole('button', { name: 'Synthetic Pathfinder' })).toBeVisible()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic')
  await page.getByLabel('Active school year').fill('2024-2025')
  await page.getByLabel('Level earned').selectOption('Friend')
  await page.getByLabel('Level status').selectOption('true')
  await page.getByRole('combobox', { name: 'Extracurricular', exact: true }).selectOption('Drums')
  await page.getByLabel('Red Zone event').selectOption('Archery')
  const request = page.waitForRequest(r => r.url().includes('/rest/v1/pathfinders?') && r.url().includes('levels='))
  await page.getByRole('button', { name: 'Search records' }).click()
  const params = new URL((await request).url()).searchParams
  expect(params.get('name')).toBe('ilike.%Synthetic%')
  expect(params.get('years_active')).toBe('cs.["2024-2025"]')
  expect(params.get('levels')).toBe('cs.[{"name":"Friend","advanced":true}]')
  expect(params.get('extracurriculars')).toBe('cs.["Drums"]')
  expect(params.get('red_zone_participation')).toBe('cs.["Archery"]')
  await page.getByRole('button', { name: 'Synthetic Pathfinder' }).click()
  const details = page.getByRole('region', { name: 'Member details' })
  await expect(details.getByText('2024-2025 — Snare')).toBeVisible()
  await expect(details.getByText('2025-2026 — Bass')).toBeVisible()
  await expect(details.getByText('2024-2025 — Exodus')).toBeVisible()
  await expect(details.getByText('2025-2026 — Teaching')).toBeVisible()
  await expect(details.getByText('2024 — 1st Place')).toBeVisible()
  await expect(details.getByText('2025 — 2nd Place')).toBeVisible()
  await expect(details.getByText('Synthetic Honor — 2025')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible()
  await expect(page.getByText('Synthetic Pathfinder')).toHaveCount(0)
})

test('distinguishes an empty result from a database failure and retries', async ({ page }) => {
  await setup(page)
  await expect(page.getByRole('button', { name: 'Synthetic Pathfinder' })).toBeVisible()
  await page.route('http://127.0.0.1:54321/rest/v1/pathfinders?**', route => route.fulfill({ json: [], headers: { 'access-control-expose-headers': 'content-range', 'content-range': '*/0' } }))
  await page.getByRole('button', { name: 'Search records' }).click()
  await expect(page.getByText('No members found.', { exact: false })).toBeVisible()
  await page.route('http://127.0.0.1:54321/rest/v1/pathfinders?**', route => route.fulfill({ status: 400, json: { message: 'Test database failure' } }))
  await page.getByRole('button', { name: 'Search records' }).click()
  await expect(page.getByRole('alert')).toContainText('Test database failure')
  await page.route('http://127.0.0.1:54321/rest/v1/pathfinders?**', route => route.fulfill({ json: [fixture], headers: { 'access-control-expose-headers': 'content-range', 'content-range': '0-0/1' } }))
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('button', { name: 'Synthetic Pathfinder' })).toBeVisible()
})

test('does not query member data for an unapproved account', async ({ page }) => {
  let memberRequests = 0
  page.on('request', request => { if (request.url().includes('/rest/v1/pathfinders')) memberRequests++ })
  await setup(page, null)
  await expect(page.getByRole('heading', { name: 'Staff access required' })).toBeVisible()
  expect(memberRequests).toBe(0)
})

test('paginates results using stable server-side ranges', async ({ page }) => {
  await setup(page)
  await expect(page.getByRole('button', { name: 'Synthetic Pathfinder' })).toBeVisible()
  await page.route('http://127.0.0.1:54321/rest/v1/pathfinders?**', route => {
    const offset = new URL(route.request().url()).searchParams.get('offset')
    return route.fulfill({ json: [{ ...fixture, id: offset === '25' ? 43 : 42, name: offset === '25' ? 'Second page member' : fixture.name }], headers: { 'access-control-expose-headers': 'content-range', 'content-range': `${offset === '25' ? '25-25' : '0-24'}/26` } })
  })
  await page.getByRole('button', { name: 'Search records' }).click()
  await expect(page.getByText('Page 1 of 2')).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Second page member' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
})
