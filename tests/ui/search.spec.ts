// Browser regression tests use mocked Supabase responses; no hosted member records are read or changed.

import { expect, test, type Page } from '@playwright/test'

const member = {
  id: 2,
  first_name: 'Justin',
  last_name: 'Wu',
  name: 'Justin Wu',
  status: 'staff',
  has_current_data: true,
  current_title: null,
  years_active: ['2023-24'],
  levels: [
    { name: 'Friend', outcome: 'basic', year: '2023-24' },
    { name: 'Companion', outcome: 'incomplete', year: null },
  ],
  birth_date: '2000-01-02',
  notes: 'Existing notes',
}
const fixture = {
  ...member,
  staff_history: {
    id: 1,
    pathfinder_id: 2,
    history: [{ year: '2025-26', titles: ['Friend Counselor', 'Drill Instructor'] }],
  },
  drill: [
    { id: 1, years: ['2023-24'], team: 'Precision' },
    { id: 2, years: ['2025-26'], team: 'Adult' },
  ],
  drum_corps: { history: [{ year: '2023-24', drums: ['Snare'] }] },
  pbe: {
    history: [
      {
        year: '2021-22',
        books: ['1 Kings', 'Ruth'],
        results: { Area: '1st Place', State: 'Participation' },
      },
    ],
  },
  tlt: { history: [{ year: '2023-24', operations: ['Teaching'] }] },
  red_zone_drill_performance: [],
  red_zone_drum_performance: [],
  red_zone_honor_evaluations: [],
  red_zone_bible_events: [],
  red_zone_knots: [],
  red_zone_tents: [],
  red_zone_jump_rope: [],
  red_zone_archery: [],
  red_zone_lashing: [],
  red_zone_burning_twine: [{ year: '2023-24', placement: '1st Place' }],
}
async function setup(page: Page) {
  const user = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'staff@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  }
  await page.route('http://127.0.0.1:54321/auth/v1/**', (route) =>
    route.fulfill({
      json: {
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        user,
      },
    }),
  )
  await page.route('http://127.0.0.1:54321/rest/v1/member_search?**', (route) =>
    route.fulfill({
      json: [member],
      headers: { 'access-control-expose-headers': 'content-range', 'content-range': '0-0/1' },
    }),
  )
  await page.route('http://127.0.0.1:54321/rest/v1/pathfinders?**', (route) =>
    route.fulfill({ json: route.request().method() === 'PATCH' ? { id: 2 } : fixture }),
  )
  await page.route('**/rest/v1/honors_earned?**', (route) => route.fulfill({ json: [] }))
  await page.route('**/rest/v1/rpc/get_master_award_status', (route) => route.fulfill({ json: [] }))
  await page.goto('/')
  await page.getByLabel('Email', { exact: true }).fill('staff@example.test')
  await page.getByLabel('Password', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open profile for Justin Wu' })).toBeVisible()
}

test('Add to Record preserves recipients across searches, confirms once and reports mixed outcomes', async ({
  page,
}) => {
  await setup(page)
  await page.route('**/rest/v1/rpc/current_club_year', (r) => r.fulfill({ json: '2026-27' }))
  await page.route('**/rest/v1/staff_titles?**', (r) =>
    r.fulfill({ json: [{ title: 'Club Director' }] }),
  )
  await page.route('**/rest/v1/pbe_year_books?**', (r) => r.fulfill({ json: [] }))
  const second = {
    ...member,
    id: 3,
    name: 'Alex Example',
    first_name: 'Alex',
    last_name: 'Example',
    status: 'parent',
  }
  const urls: string[] = []
  await page.route('**/rest/v1/member_search?**', (r) => {
    urls.push(r.request().url())
    const rows = r.request().url().includes('Alex') ? [second] : [member]
    return r.fulfill({
      json: rows,
      headers: { 'access-control-expose-headers': 'content-range', 'content-range': '0-0/1' },
    })
  })
  let payload: Record<string, unknown> | undefined
  let release: (() => void) | undefined
  await page.route('**/rest/v1/rpc/add_to_records', async (r) => {
    payload = r.request().postDataJSON()
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await r.fulfill({
      json: [
        { id: 2, name: 'Justin Wu', status: 'added', year_added: true },
        { id: 3, name: 'Alex Example', status: 'already', year_added: true },
      ],
    })
  })
  await page.getByRole('button', { name: 'Add to Record', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add to Record', exact: true })
  await dialog.getByRole('combobox', { name: 'Year to document', exact: true }).click()
  await expect(dialog.getByRole('option', { name: '2010-11', exact: true })).toHaveCount(1)
  await expect(dialog.getByRole('option', { name: '2009-10', exact: true })).toHaveCount(0)
  await dialog.getByRole('combobox', { name: 'Year to document', exact: true }).fill('2025-26')
  await dialog.getByRole('combobox', { name: 'Year to document', exact: true }).press('Enter')
  await dialog.getByLabel('Information category').selectOption('drums')
  await expect(dialog.getByLabel('Historical role')).toHaveCount(0)
  const beforeOptions = await dialog.getByRole('button', { name: 'Select profiles' }).boundingBox()
  await dialog.getByRole('combobox', { name: 'Instruments' }).click()
  expect((await dialog.getByRole('button', { name: 'Select profiles' }).boundingBox())?.y).toBe(
    beforeOptions?.y,
  )
  await dialog.getByRole('option', { name: 'Snare', exact: true }).click()
  await dialog.getByRole('option', { name: 'Bass', exact: true }).click()
  await page.keyboard.press('Escape')
  await dialog.getByRole('button', { name: 'Select profiles' }).click()
  const dialogSize = await dialog.boundingBox()
  expect(dialogSize!.width).toBeGreaterThan(page.viewportSize()!.width * 0.9)
  await dialog.getByRole('checkbox', { name: 'Select Justin Wu' }).check()
  await dialog.getByLabel('Name', { exact: true }).fill('Alex')
  await dialog.getByRole('button', { name: 'Search records' }).click()
  await dialog.getByRole('checkbox', { name: 'Select Alex Example' }).check()
  await expect(dialog).toContainText('Selected profiles (2)')
  expect(
    await dialog
      .getByRole('region', { name: 'Selected profiles', exact: true })
      .evaluate(
        (node) =>
          !!(
            node.compareDocumentPosition(document.querySelector('dialog table')!) &
            Node.DOCUMENT_POSITION_PRECEDING
          ),
      ),
  ).toBe(true)
  expect(urls.every((url) => new URL(url).searchParams.get('status') === null)).toBe(true)
  expect(new URL(urls[0]).searchParams.get('order')).toBe(
    'sort_status.asc,sort_title.asc,sort_last_name.asc,sort_first_name.asc,id.asc',
  )
  await page.screenshot({ path: 'test-results/recipient-search.png', fullPage: true })
  await dialog.getByRole('button', { name: 'Finish / Done' }).click()
  const review = page.getByRole('dialog', { name: 'Confirm Additions' })
  await expect(review).toContainText('Justin Wu')
  await expect(review).toContainText('Alex Example')
  expect(payload).toBeUndefined()
  await expect(review.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/history-confirmation.png', fullPage: true })
  await review.getByRole('button', { name: 'Confirm', exact: true }).click()
  const pending = page.getByRole('dialog', { name: 'Adding to Records' })
  await expect(pending.getByRole('button', { name: 'Close' })).toBeDisabled()
  await expect.poll(() => !!release).toBe(true)
  release!()
  const result = page.getByRole('dialog', { name: 'Records Updated' })
  await expect(result).toContainText('Added (1)')
  await expect(result).toContainText('Already had this information (1)')
  await expect(result).toContainText('Years Active updated')
  expect(payload).toEqual({
    p_ids: [2, 3],
    p_year: '2025-26',
    p_entry: { kind: 'drums', details: ['Snare', 'Bass'] },
  })
  await page.screenshot({ path: 'test-results/history-receipt.png', fullPage: true })
})

test('PBE includes every book for the year and only Staff titles restrict recipients', async ({
  page,
}) => {
  await setup(page)
  await page.route('**/rest/v1/rpc/current_club_year', (r) => r.fulfill({ json: '2026-27' }))
  await page.route('**/rest/v1/staff_titles?**', (r) =>
    r.fulfill({ json: [{ title: 'Club Director' }] }),
  )
  await page.route('**/rest/v1/pbe_year_books?**', (r) =>
    r.fulfill({
      json: [
        { school_year: '2024-25', book_name: 'Romans' },
        { school_year: '2024-25', book_name: '1 Corinthians' },
        { school_year: '2024-25', book_name: '2 Corinthians' },
        { school_year: '2026-27', book_name: 'Mark' },
      ],
    }),
  )
  let payload: Record<string, unknown> | undefined
  await page.route('**/rest/v1/rpc/add_to_records', (r) => {
    payload = r.request().postDataJSON()
    return r.fulfill({ json: [{ id: 2, name: 'Justin Wu', status: 'added', year_added: true }] })
  })
  await page.getByRole('button', { name: 'Add to Record', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add to Record', exact: true })
  await dialog.getByLabel('Information category').selectOption('staff')
  await dialog.getByRole('combobox', { name: 'Year to document', exact: true }).fill('2026-27')
  await dialog.getByRole('combobox', { name: 'Year to document', exact: true }).press('Enter')
  await dialog.getByRole('combobox', { name: 'Staff title', exact: true }).fill('Club Director')
  await dialog.getByRole('combobox', { name: 'Staff title', exact: true }).press('Enter')
  const staffSearch = page.waitForRequest(
    (r) =>
      r.url().includes('/member_search?') &&
      new URL(r.url()).searchParams.get('status') === 'neq.pathfinder',
  )
  await dialog.getByRole('button', { name: 'Select profiles' }).click()
  await staffSearch
  await dialog.getByRole('checkbox', { name: 'Select Justin Wu' }).check()
  await dialog.getByRole('button', { name: 'Back to information' }).click()
  await dialog.getByLabel('Information category').selectOption('pbe')
  await dialog.getByRole('combobox', { name: 'Year to document', exact: true }).fill('2024-25')
  await dialog.getByRole('combobox', { name: 'Year to document', exact: true }).press('Enter')
  const books = dialog.getByRole('region', { name: 'Bible books' })
  await expect(books).toContainText('Romans')
  await expect(books).toContainText('1 Corinthians')
  await expect(books).toContainText('2 Corinthians')
  await expect(books).not.toContainText('Mark')
  await expect(books.getByRole('combobox')).toHaveCount(0)
  await expect(books.locator('ul')).toHaveCount(0)
  await expect(books).toContainText('Romans, 1 Corinthians, 2 Corinthians')
  await dialog.getByRole('combobox', { name: 'PBE regions (optional)', exact: true }).click()
  await expect(
    dialog.getByRole('option', { name: 'State / Participation', exact: true }),
  ).toBeDisabled()
  await expect(
    dialog.getByRole('option', { name: 'Divisional / 1st Place', exact: true }),
  ).toBeDisabled()
  await dialog.getByRole('option', { name: 'Area / 1st Place', exact: true }).click()
  await expect(dialog.getByRole('option', { name: 'Area / 2nd Place', exact: true })).toBeDisabled()
  await dialog.getByRole('option', { name: 'State / Participation', exact: true }).click()
  await dialog.getByRole('option', { name: 'Union / 2nd Place', exact: true }).click()
  await expect(
    dialog.getByRole('option', { name: 'Divisional / 1st Place', exact: true }),
  ).toBeEnabled()
  await page.keyboard.press('Escape')
  await dialog
    .getByRole('button', {
      name: 'Remove State / Participation from PBE regions (optional)',
      exact: true,
    })
    .click()
  await expect(
    dialog.getByRole('button', {
      name: 'Remove Union / 2nd Place from PBE regions (optional)',
      exact: true,
    }),
  ).toHaveCount(0)
  await dialog
    .getByRole('combobox', { name: 'PBE regions (optional)', exact: true })
    .fill('State / Participation')
  await dialog.getByRole('combobox', { name: 'PBE regions (optional)', exact: true }).press('Enter')
  await page.keyboard.press('Escape')
  await expect(dialog.getByRole('heading', { name: 'Bible books', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Select profiles' }).click()
  await expect(dialog.getByRole('checkbox', { name: 'Select Justin Wu' })).not.toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Finish / Done' })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: 'Select Justin Wu' }).check()
  await dialog.getByRole('button', { name: 'Finish / Done' }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Records Updated' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Records Updated' })).toContainText(
    'Area: 1st Place; State: Participation',
  )
  expect(payload).toEqual({
    p_ids: [2],
    p_year: '2024-25',
    p_entry: {
      kind: 'pbe',
      details: ['Romans', '1 Corinthians', '2 Corinthians'],
      results: { Area: '1st Place', State: 'Participation' },
    },
  })
})

test('Honor lookup on mobile and batch errors retain the proposed addition', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await page.route('**/rest/v1/rpc/current_club_year', (r) => r.fulfill({ json: '2026-27' }))
  await page.route('**/rest/v1/staff_titles?**', (r) => r.fulfill({ json: [] }))
  await page.route('**/rest/v1/pbe_year_books?**', (r) => r.fulfill({ json: [] }))
  await page.route('**/rest/v1/honors?**', (r) =>
    r.fulfill({ json: [{ id: 8, name: 'Camping Skills I' }] }),
  )
  let calls = 0
  await page.route('**/rest/v1/rpc/add_to_records', (r) => {
    calls++
    return calls === 1
      ? r.fulfill({ status: 503, json: { message: 'Connection unavailable' } })
      : r.fulfill({
          json: [
            {
              id: 2,
              name: 'Justin Wu',
              status: 'error',
              reason: 'Profile is no longer available.',
              year_added: false,
            },
          ],
        })
  })
  await page.getByRole('button', { name: 'Add to Record', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add to Record', exact: true })
  await expect(dialog.getByRole('button', { name: 'Select profiles' })).toBeEnabled()
  await expect(
    dialog.getByRole('button', { name: 'Remove 2026-27 from Year to document', exact: true }),
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('button', { name: 'Remove Basic from Outcome', exact: true }),
  ).toHaveCount(0)
  await dialog.getByRole('combobox', { name: 'Year to document', exact: true }).fill('2026-27')
  await dialog.getByRole('combobox', { name: 'Year to document', exact: true }).press('Enter')
  await dialog.getByLabel('Information category').selectOption('honor')
  await expect(dialog.getByLabel('Historical role')).toHaveCount(0)
  await dialog.getByLabel('Find an honor').fill('Camping')
  await dialog.getByRole('option', { name: 'Camping Skills I', exact: true }).click()
  await page.screenshot({ path: 'test-results/history-mobile.png', fullPage: true })
  await dialog.getByRole('button', { name: 'Select profiles' }).click()
  await dialog.getByRole('checkbox', { name: 'Select Justin Wu' }).check()
  await dialog.getByRole('button', { name: 'Finish / Done' }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Connection unavailable')
  await page.getByRole('button', { name: 'Back to confirmation' }).click()
  await expect(page.getByRole('dialog')).toContainText('Camping Skills I')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  const result = page.getByRole('dialog', { name: 'Completed with Errors' })
  await expect(result).toContainText('Not added (1)')
  await expect(result).toContainText('Profile is no longer available.')
  await result.getByRole('button', { name: 'Review failed profiles' }).click()
  await expect(
    dialog.getByRole('button', { name: 'Remove 2026-27 from Year to document', exact: true }),
  ).toBeVisible()
})

test('Add Record saves once, keeps failures editable, and refreshes Search', async ({ page }) => {
  await setup(page)
  await page.route('**/rest/v1/rpc/current_club_year', (route) =>
    route.fulfill({ json: '2026-27' }),
  )
  await page.route('**/rest/v1/staff_titles?**', (route) =>
    route.fulfill({
      json: [
        'Club Director',
        'Friend Counselor',
        'Companion Counselor',
        'Drill Instructor',
        'Drum Corps Leader',
        'Master Guide Leader',
      ].map((title) => ({ title })),
    }),
  )
  const requests: Record<string, unknown>[] = []
  let release: (() => void) | undefined
  await page.route('**/rest/v1/rpc/add_member_record', async (route) => {
    requests.push(route.request().postDataJSON())
    if (requests.length === 1)
      return route.fulfill({
        status: 409,
        json: {
          code: '23505',
          message:
            'A profile with this first and last name already exists. Find the existing profile in Search.',
        },
      })
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await route.fulfill({ json: 42 })
  })
  await page.getByRole('button', { name: 'Add New Profile', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Add New Profile', exact: true })
  await expect(form.getByLabel('Current Year')).toHaveValue('2026-2027')
  await form.getByLabel('First Name', { exact: true }).fill(' New ')
  await form.getByLabel('Last Name').fill('Member')
  await form.getByLabel('Birthday').fill('2001-02-03')
  await form.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Staff')
  await form.getByRole('combobox', { name: 'Class/Title' }).click()
  await expect(form.locator('.level-name')).toHaveText([
    'Counselor',
    'Instructor',
    'Leader',
    'Other',
  ])
  await page.screenshot({ path: 'test-results/add-record-desktop.png', fullPage: true })
  await form.getByRole('option', { name: 'Friend Counselor', exact: true }).click()
  await form.getByRole('option', { name: 'Companion Counselor', exact: true }).click()
  await page.keyboard.press('Escape')
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await form.getByRole('button', { name: /Confirm/ }).click()
  const failure = page.getByRole('dialog', { name: 'Unable to Add Record', exact: true })
  await expect(failure.getByRole('alert')).toContainText(
    'A profile with this first and last name already exists.',
  )
  await page.screenshot({ path: 'test-results/add-record-error.png', fullPage: true })
  await failure.getByRole('button', { name: 'Back to form' }).click()
  await expect(form.getByLabel('First Name', { exact: true })).toHaveValue(' New ')
  await expect(page.getByRole('dialog', { name: 'Record Added', exact: true })).toHaveCount(0)
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await form.getByRole('button', { name: /Confirm/ }).click()
  const pending = page.getByRole('dialog', { name: 'Adding Record', exact: true })
  await expect(pending).toContainText('Saving the new profile')
  await page.screenshot({ path: 'test-results/add-record-loading.png', fullPage: true })
  await expect(pending.getByRole('button', { name: 'Close', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(pending).toBeVisible()
  const refreshed = page.waitForRequest((r) => r.url().includes('/member_search?'))
  await expect.poll(() => !!release).toBe(true)
  release!()
  const summary = page.getByRole('dialog', { name: 'Record Added', exact: true })
  await expect(summary).toContainText('New Member')
  await expect(summary).toContainText('02/03/2001')
  await expect(summary).toContainText('Friend Counselor, Companion Counselor')
  await page.screenshot({ path: 'test-results/record-added.png', fullPage: true })
  await refreshed
  expect(requests).toHaveLength(2)
  expect(requests[0]).toEqual(requests[1])
  expect(requests[1]).toMatchObject({
    p_first_name: 'New',
    p_last_name: 'Member',
    p_birth_date: '2001-02-03',
    p_status: 'staff',
    p_current_title: ['Friend Counselor', 'Companion Counselor'],
    p_school_year: '2026-27',
  })
  await summary.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add New Profile', exact: true })).toBeFocused()
})

test('Add confirmation expires and status changes clear incompatible titles', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await page.route('**/rest/v1/rpc/current_club_year', (route) =>
    route.fulfill({ json: '2026-27' }),
  )
  await page.route('**/rest/v1/staff_titles?**', (route) => route.fulfill({ json: [] }))
  let writes = 0
  await page.route('**/rest/v1/rpc/add_member_record', (route) => {
    writes++
    return route.fulfill({ json: 43 })
  })
  await page.getByRole('button', { name: 'Add New Profile', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Add New Profile', exact: true })
  await form.getByLabel('First Name', { exact: true }).fill('Example')
  await form.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Pathfinder')
  const classSelect = form.getByRole('combobox', { name: 'Class/Title' })
  await classSelect.selectOption('Friend')
  await classSelect.selectOption('Companion')
  await expect(classSelect).toHaveValue('Companion')
  await expect(classSelect.locator('option:checked')).toHaveCount(1)
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(form.getByRole('button', { name: /Confirm/ })).toBeVisible()
  await form.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Parent')
  await expect(form.getByRole('button', { name: 'Add', exact: true })).toBeVisible()
  await expect(form.getByLabel('Class/Title')).toBeDisabled()
  await page.screenshot({ path: 'test-results/add-record-mobile.png', fullPage: true })
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(form.getByRole('button', { name: 'Add', exact: true })).toBeVisible({
    timeout: 7000,
  })
  expect(writes).toBe(0)
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  const request = page.waitForRequest('**/rest/v1/rpc/add_member_record')
  await form.getByRole('button', { name: /Confirm/ }).click()
  expect((await request).postDataJSON()).toMatchObject({
    p_current_title: null,
    p_birth_date: null,
    p_status: 'parent',
  })
  await expect(page.getByRole('dialog', { name: 'Record Added', exact: true })).toContainText('N/A')
})

test('current results use a separate profile button and omit retired activities', async ({
  page,
}) => {
  await setup(page)
  await expect(page.getByRole('columnheader')).toHaveText([
    'Profile',
    'First Name',
    'Last Name',
    'Status',
    'Class/Titles',
  ])
  await expect(page.getByRole('row').last()).toContainText('Staff')
  await expect(page.getByRole('row').last()).toContainText('Not recorded')
  await expect(page.getByRole('row').last().getByRole('cell').nth(1)).toHaveText('Justin')
  await expect(
    page.getByRole('row').last().getByRole('cell').nth(1).getByRole('button'),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open profile for Justin Wu' })).not.toHaveText(
    'Justin',
  )
  const status = page.getByRole('combobox', { name: 'Status', exact: true })
  await expect(status.locator('option')).toHaveText([
    'Any',
    'Pathfinder',
    'Staff',
    'Parent',
    'Not Active',
  ])
  const request = page.waitForRequest((r) => r.url().includes('status=eq.not_active'))
  await status.selectOption('Not Active')
  await page.getByRole('button', { name: 'Search records' }).click()
  await request
})

test('role histories retain year detail links and nested honors focus', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'Open profile for Justin Wu' }).click()
  const profile = page.getByRole('dialog', { name: 'Member profile' })
  await expect(profile).toContainText('01/02/2000')
  const pf = profile.getByRole('region', { name: 'Pathfinder history' })
  const staff = profile.getByRole('region', { name: 'Staff history' })
  await expect(pf).toContainText('Friend (Basic)')
  await expect(pf).toContainText('Companion (Incomplete)')
  await expect(pf).toContainText('Unknown')
  await expect(pf).toContainText('Precision')
  await expect(pf).toContainText('Snare')
  await expect(pf).not.toContainText('1 Kings, Ruth')
  await expect(pf).toContainText('Area (1st), State (P)')
  await expect(pf).toContainText('Teaching')
  await expect(pf).toContainText('Adult')
  await expect(staff).not.toContainText('Adult')
  await expect(staff).toContainText('Drill Instructor, Friend Counselor')
  await page.route('**/rest/v1/honors_earned?**', (route) =>
    route.fulfill({
      json: [{ id: 1, year_earned: '2023-24', honors: { name: 'Camping Skills I' } }],
    }),
  )
  await profile.getByRole('button', { name: 'View Honors' }).click()
  const honors = page.getByRole('dialog', { name: 'Honors', exact: true })
  await expect(honors).toContainText('Camping Skills I')
  await expect(honors).toContainText('2023-24')
  await expect(honors).not.toContainText('Staff')
  await expect(honors).not.toContainText('Pathfinder')
  await page.keyboard.press('Escape')
  await expect(profile.getByRole('button', { name: 'View Honors' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Open profile for Justin Wu' })).toBeFocused()
})

test('Notes are read-only with the Edit Profile action', async ({ page }) => {
  await setup(page)
  await expect(page.getByRole('button', { name: 'Add New Profile', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add to Record', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Member pages' })).toHaveCount(0)
  await page.route('**/rest/v1/pathfinders?**', (route) =>
    route.fulfill({ json: { ...fixture, notes: 'First sentence.\n\nSecond paragraph.' } }),
  )
  await page.getByRole('button', { name: 'Open profile for Justin Wu' }).click()
  const notes = page.getByRole('region', { name: 'Notes', exact: true })
  await expect(notes.locator('p')).toHaveText('First sentence.\n\nSecond paragraph.')
  await expect(notes.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save Notes' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit Profile', exact: true })).toBeEnabled()
})

test('shared years constrain every category with OR bubbles and AND categories', async ({
  page,
}) => {
  await setup(page)
  const years = page.getByRole('combobox', { name: 'Years', exact: true })
  await years.fill('2023-24')
  await years.press('Enter')
  const level = page.getByRole('combobox', { name: 'Level Earned', exact: true })
  await level.fill('Friend')
  await expect(page.getByRole('option', { name: 'Friend (2023-24)', exact: true })).toHaveCount(0)
  await page.getByRole('option', { name: 'Friend / Basic', exact: true }).click()
  await level.fill('Friend / Advanced')
  await level.press('Enter')
  const activity = page.getByRole('combobox', { name: 'Extracurricular', exact: true })
  await activity.fill('Drums / Snare')
  await activity.press('Enter')
  await activity.fill('TLT / Teaching')
  await activity.press('Enter')
  const event = page.getByRole('combobox', { name: 'Red Zone Events', exact: true })
  await event.fill('Burning Twine / 1st Place')
  await event.press('Enter')
  await event.press('Escape')
  const request = page.waitForRequest((r) => r.url().includes('or='))
  await page.getByRole('button', { name: 'Search records' }).click()
  const expression = new URL((await request).url()).searchParams.get('or')!
  expect(expression).toContain('(and(or(levels.cs.')
  expect(expression).toContain('),or(search_activity_details.cs.')
  expect(expression).toContain('),or(search_event_details.cs.')
  const decoded = expression.replaceAll('\\"', '"')
  expect(decoded).toContain('"outcome":"basic","year":"2023-24"')
  expect(decoded).toContain('"outcome":"advanced","year":"2023-24"')
  expect(decoded).toContain('"name":"Drums","detail":"Snare","year":"2023-24"')
  expect(decoded).toContain('"name":"TLT","detail":"Teaching","year":"2023-24"')
  expect(decoded).toContain('"name":"Burning Twine","detail":"1st Place","year":"2023-24"')
  expect(expression).not.toContain('search_years')
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0)
})

test('profile handles missing data and retries failed loads', async ({ page }) => {
  await setup(page)
  let attempts = 0
  await page.route('**/rest/v1/pathfinders?**', (route) => {
    expect(new URL(route.request().url()).searchParams.get('select')).not.toContain('honors')
    attempts++
    return attempts === 1
      ? route.fulfill({ status: 500, json: { message: 'Profile unavailable' } })
      : route.fulfill({
          json: { ...fixture, levels: [], years_active: [], staff_history: null, birth_date: null },
        })
  })
  await page.getByRole('button', { name: 'Open profile for Justin Wu' }).click()
  await expect(page.getByRole('alert')).toContainText('Profile unavailable')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('No levels recorded', { exact: true })).toBeVisible()
  await expect(page.getByText('No staff years or titles recorded', { exact: true })).toBeVisible()
})

test('profile remains scrollable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await page.getByRole('button', { name: 'Open profile for Justin Wu' }).click()
  const dialog = page.getByRole('dialog', { name: 'Member profile' })
  await expect(dialog.getByText('Friend (Basic)', { exact: false })).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box!.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'test-results/profile-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'test-results/profile-desktop.png' })
})

test('group headings and outer areas replace Any without swallowing detail clicks', async ({
  page,
}) => {
  await setup(page)
  const input = page.getByRole('combobox', { name: 'Extracurricular', exact: true })
  await input.fill('Drums')
  await expect(
    page
      .getByRole('listbox', { name: 'Extracurricular options' })
      .getByRole('option', { name: 'Any', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('option', { name: 'Drums / Snare', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Remove Drums from Extracurricular', exact: true }),
  ).toHaveCount(0)
  await input.fill('Drums')
  await input.click()
  await page.getByRole('option', { name: 'Drums', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Remove Drums from Extracurricular', exact: true }),
  ).toBeVisible()
  const level = page.getByRole('combobox', { name: 'Level Earned', exact: true })
  await level.fill('Friend')
  await level.press('Enter')
  await expect(
    page.getByRole('button', { name: 'Remove Friend from Level Earned', exact: true }),
  ).toBeVisible()
  const event = page.getByRole('combobox', { name: 'Red Zone Events', exact: true })
  await event.fill('Archery')
  await page
    .getByRole('group', { name: 'Archery', exact: true })
    .locator('..')
    .click({ position: { x: 2, y: 2 } })
  await expect(
    page.getByRole('button', { name: 'Remove Archery from Red Zone Events', exact: true }),
  ).toBeVisible()
})

test('PBE search links region and placement bubbles to the selected year', async ({ page }) => {
  await setup(page)
  await page.getByRole('combobox', { name: 'Years', exact: true }).fill('2024-25')
  await page.getByRole('combobox', { name: 'Years', exact: true }).press('Enter')
  await page.keyboard.press('Escape')
  await page.getByRole('combobox', { name: 'Extracurricular', exact: true }).click()
  await page.getByRole('combobox', { name: 'PBE region', exact: true }).selectOption('State')
  await page.getByRole('option', { name: 'PBE / State / 1st Place', exact: true }).click()
  await page.getByRole('combobox', { name: 'Extracurricular', exact: true }).click()
  await page.getByRole('option', { name: 'PBE / State / Participation', exact: true }).click()
  await expect(
    page.getByRole('button', {
      name: 'Remove PBE / State / 1st Place from Extracurricular',
      exact: true,
    }),
  ).toBeVisible()
  await page.getByRole('combobox', { name: 'Extracurricular', exact: true }).click()
  await page.getByRole('combobox', { name: 'PBE region', exact: true }).selectOption('Union')
  await expect(
    page.getByRole('option', { name: 'PBE / Union / 2nd Place', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  const request = page.waitForRequest(
    (r) => r.url().includes('/member_search?') && r.url().includes('search_activity_details'),
  )
  await page.getByRole('button', { name: 'Search records' }).click()
  const expression = new URL((await request).url()).searchParams.get('or')!.replaceAll('\\"', '"')
  expect(expression).toContain('"name":"PBE","detail":"State / 1st Place","year":"2024-25"')
  expect(expression).toContain('"name":"PBE","detail":"State / Participation","year":"2024-25"')
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByRole('combobox', { name: 'Extracurricular', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'PBE region', exact: true })).toHaveValue('')
})

test('Unknown PBE year saves without books and undated history follows dated records', async ({
  page,
}) => {
  await setup(page)
  await page.route('**/rest/v1/rpc/current_club_year', (r) => r.fulfill({ json: '2026-27' }))
  await page.route('**/rest/v1/staff_titles?**', (r) => r.fulfill({ json: [] }))
  await page.route('**/rest/v1/pbe_year_books?**', (r) => r.fulfill({ json: [] }))
  let payload: Record<string, unknown> | undefined
  await page.route('**/rest/v1/rpc/add_to_records', (r) => {
    payload = r.request().postDataJSON()
    return r.fulfill({ json: [{ id: 2, name: 'Justin Wu', status: 'added', year_added: false }] })
  })
  await page.getByRole('button', { name: 'Add to Record', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add to Record', exact: true })
  await dialog.getByLabel('Information category').selectOption('pbe')
  await dialog.getByRole('combobox', { name: 'Year to document', exact: true }).fill('Unknown')
  await dialog.getByRole('combobox', { name: 'Year to document', exact: true }).press('Enter')
  await expect(dialog).toContainText('Bible books cannot be determined without a year.')
  await dialog
    .getByRole('combobox', { name: 'PBE regions (optional)', exact: true })
    .fill('Area / 1st Place')
  await dialog.getByRole('combobox', { name: 'PBE regions (optional)', exact: true }).press('Enter')
  await page.keyboard.press('Escape')
  await dialog.getByRole('button', { name: 'Select profiles' }).click()
  await dialog.getByRole('checkbox', { name: 'Select Justin Wu' }).check()
  await dialog.getByRole('button', { name: 'Finish / Done' }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Records Updated' })).toContainText('Unknown')
  expect(payload).toEqual({
    p_ids: [2],
    p_year: null,
    p_entry: { kind: 'pbe', details: [], results: { Area: '1st Place' } },
  })
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.route('**/rest/v1/pathfinders?**', (r) =>
    r.fulfill({
      json: {
        ...fixture,
        staff_history: {
          history: [
            { year: null, titles: ['Club Director'] },
            { year: '2023-24', titles: ['Friend Counselor'] },
          ],
        },
        drum_corps: {
          history: [
            { year: null, drums: ['Bass'] },
            { year: '2024-25', drums: ['Snare'] },
          ],
        },
        red_zone_archery: [
          { year: null, placement: 'Participation' },
          { year: '2024-25', placement: '1st Place' },
        ],
      },
    }),
  )
  await page.route('**/rest/v1/honors_earned?**', (r) =>
    r.fulfill({
      json: [
        { id: 1, year_earned: null, honors: { name: 'Unknown honor' } },
        { id: 2, year_earned: '2024-25', honors: { name: 'Dated honor' } },
      ],
    }),
  )
  await page.getByRole('button', { name: 'Open profile for Justin Wu' }).click()
  const profile = page.getByRole('dialog', { name: 'Member profile' })
  for (const name of ['Levels', 'Years and Titles', 'Drum']) {
    const section = profile
      .locator('section')
      .filter({ has: page.getByRole('heading', { name, exact: true }) })
      .last()
    await expect(section.locator('dt').last()).toHaveText('Unknown')
    expect(
      await section
        .locator('.unknown-history')
        .first()
        .evaluate((node) => parseFloat(getComputedStyle(node).marginTop)),
    ).toBeGreaterThan(0)
  }
  const archery = profile.getByRole('region', { name: 'Archery', exact: true })
  await expect(archery.locator('dt').last()).toContainText('Unknown')
  await profile.getByRole('button', { name: 'View Honors' }).click()
  const honors = page.getByRole('dialog', { name: 'Honors', exact: true })
  await expect(honors.locator('dt').last()).toHaveText('Unknown')
})

test('search keeps Staff Title below History type and Name widest', async ({ page }) => {
  await setup(page)
  await page.route('**/rest/v1/staff_titles?**', (route) =>
    route.fulfill({ json: [{ title: 'Club Director' }] }),
  )
  await page.getByRole('combobox', { name: 'History type' }).selectOption('staff')
  for (const width of [1280, 900, 700]) {
    await page.setViewportSize({ width, height: 1000 })
    const top = await Promise.all(
      [
        page.getByRole('searchbox', { name: 'Name', exact: true }),
        page.getByRole('combobox', { name: 'Status', exact: true }),
        page.getByRole('combobox', { name: 'History type', exact: true }),
        page.getByRole('combobox', { name: 'Years', exact: true }),
      ].map((control) => control.boundingBox()),
    )
    for (let i = 1; i < top.length; i++) {
      expect(top[i]!.x).toBeGreaterThan(top[i - 1]!.x)
      expect(Math.abs(top[i]!.y - top[0]!.y)).toBeLessThan(2)
      expect(top[0]!.width).toBeGreaterThan(top[i]!.width)
    }
    const staff = await page
      .getByRole('combobox', { name: 'Staff Title', exact: true })
      .boundingBox()
    const activity = await page
      .getByRole('combobox', { name: 'Extracurricular', exact: true })
      .boundingBox()
    expect(staff!.y).toBeGreaterThan(top[0]!.y + top[0]!.height)
    expect(Math.abs(staff!.y - activity!.y)).toBeLessThan(2)
    await page.screenshot({ path: `test-results/search-layout-${width}.png`, fullPage: true })
  }
})

async function returnToEditor(page: Page) {
  const section = page.locator('dialog.footer-overlay')
  if (await section.count()) {
    await section.getByRole('button', { name: 'Back to Edit Profile', exact: true }).click()
    await expect(section).toHaveCount(0)
  }
}
async function editSection(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name: `Edit ${name}`, exact: true })
  if (!(await dialog.count())) {
    await returnToEditor(page)
    await page
      .getByRole('dialog', { name: 'Edit Profile', exact: true })
      .getByRole('button', { name: `Edit ${name}`, exact: true })
      .click()
  }
  return dialog.getByRole('region', { name, exact: true })
}

async function setupEditor(page: Page) {
  await setup(page)
  const profile = {
    pathfinders: [
      {
        id: 2,
        first_name: 'Justin',
        last_name: 'Wu',
        birth_date: member.birth_date,
        notes: member.notes,
        years_active: member.years_active,
        levels: member.levels,
      },
    ],
    current_data: [
      {
        pathfinder_id: 2,
        school_year: '2026-27',
        status: 'staff',
        current_title: ['Club Director'],
      },
    ],
    staff_history: [fixture.staff_history],
    drill: fixture.drill,
    drum_corps: [{ id: 1, ...fixture.drum_corps }],
    pbe: [{ id: 1, ...fixture.pbe }],
    tlt: [{ id: 1, ...fixture.tlt }],
    ...Object.fromEntries(Object.entries(fixture).filter(([key]) => key.startsWith('red_zone_'))),
    honors_earned: [{ id: 1, honor_id: 8, year_earned: '2023-24' }],
  }
  await page.route('**/rest/v1/rpc/get_profile_for_edit', (r) => r.fulfill({ json: profile }))
  await page.route('**/rest/v1/staff_titles?**', (r) =>
    r.fulfill({
      json: [
        { title: 'Club Director' },
        { title: 'Friend Counselor' },
        { title: 'Drill Instructor' },
      ],
    }),
  )
  await page.route('**/rest/v1/pbe_year_books?**', (r) =>
    r.fulfill({
      json: [
        { school_year: '2021-22', book_name: '1 Kings' },
        { school_year: '2021-22', book_name: 'Ruth' },
      ],
    }),
  )
  await page.route('**/rest/v1/honors_earned?**', (r) =>
    r.fulfill({
      json: [{ id: 1, year_earned: '2023-24', honors: { id: 8, name: 'Camping Skills I' } }],
    }),
  )
  await page.route('**/rest/v1/honors?**', (r) =>
    r.fulfill({ json: [{ id: 8, name: 'Camping Skills I' }] }),
  )
  await page.getByRole('button', { name: 'Open profile for Justin Wu' }).click()
  await page.getByRole('button', { name: 'Edit Profile', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Edit Profile', exact: true })
  await expect(editor.getByLabel('First Name', { exact: true })).toHaveValue('Justin')
  return { editor, profile }
}

test('honor search stays empty until typing, groups bubbles, and pairs selected IDs with years', async ({
  page,
}) => {
  await setup(page)
  const catalog = [
    { id: 8, name: 'Camping Skills I', category: 'Recreation' },
    { id: 9, name: 'Abraham & Sand Art', category: 'Florida' },
    { id: 10, name: 'Basketry', category: 'Arts & Crafts' },
    { id: 600, name: 'Aquatic Master Award', category: 'Master Award' },
  ]
  let reads = 0
  await page.route('**/rest/v1/honors?**', (r) => {
    reads++
    return r.fulfill({ json: catalog })
  })
  const input = page.getByRole('combobox', { name: 'Honors', exact: true })
  await input.click()
  await input.fill('   ')
  await page.waitForTimeout(300) // Longer than the lookup debounce: blank input must not request data.
  expect(reads).toBe(0)
  await expect(page.getByRole('listbox', { name: 'Honors options' })).toHaveCount(0)
  await input.fill('a')
  const options = page.getByRole('listbox', { name: 'Honors options' })
  await expect(options.getByRole('group')).toHaveCount(4)
  await expect(options.locator('.level-name')).toHaveText([
    'Arts & Crafts',
    'Recreation',
    'Florida',
    'Master Award',
  ])
  await page.screenshot({ path: 'test-results/grouped-honors-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await input.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/grouped-honors-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  // Adding whitespace does not erase an already fetched result or leave loading stuck.
  await input.fill('a ')
  await expect(options.getByRole('option', { name: 'Camping Skills I', exact: true })).toBeVisible()
  await options.getByRole('option', { name: 'Camping Skills I', exact: true }).click()
  await expect(input).toHaveAttribute('aria-expanded', 'false')
  await input.fill('Aquatic')
  await expect(
    page.getByRole('button', { name: 'Remove Camping Skills I from Honors' }),
  ).toBeVisible()
  await page.getByRole('option', { name: 'Aquatic Master Award', exact: true }).click()
  const years = page.getByRole('combobox', { name: 'Years', exact: true })
  await years.fill('2024')
  await page.getByRole('option', { name: '2024-25', exact: true }).click()
  const request = page.waitForRequest(
    (r) => r.url().includes('member_search?') && r.url().includes('or='),
  )
  await page.getByRole('button', { name: 'Search records' }).click()
  const expression = new URL((await request).url()).searchParams.get('or')!.replaceAll('\\"', '"')
  expect(expression).toContain('"honor_id":8,"year":"2024-25"')
  expect(expression).toContain('"honor_id":600,"year":"2024-25"')
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByRole('button', { name: /Remove .* from Honors/ })).toHaveCount(0)
})

test('clearing honor text suppresses an in-flight response and lookup errors can retry', async ({
  page,
}) => {
  await setup(page)
  let release: (() => void) | undefined
  let entered: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  let calls = 0
  await page.route('**/rest/v1/honors?**', async (route) => {
    calls++
    if (calls === 1) {
      entered!()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return route.fulfill({ json: [{ id: 8, name: 'Camping Skills I', category: 'Recreation' }] })
    }
    if (calls === 2)
      return route.fulfill({ status: 400, json: { message: 'Honor lookup unavailable' } })
    return route.fulfill({ json: [{ id: 8, name: 'Camping Skills I', category: 'Recreation' }] })
  })
  const input = page.getByRole('combobox', { name: 'Honors', exact: true })
  await input.fill('Camping')
  await started
  await input.fill('')
  release!()
  await expect(page.getByRole('listbox', { name: 'Honors options' })).toHaveCount(0)
  await input.fill('Camping')
  await expect(page.getByRole('alert')).toContainText('Honor lookup unavailable')
  await page.getByRole('button', { name: 'Retry honors', exact: true }).click()
  await input.click()
  await expect(page.getByRole('option', { name: 'Camping Skills I', exact: true })).toBeVisible()
})

test('Honors dialog groups years earliest first with alphabetical honors and separates awards', async ({
  page,
}) => {
  await setup(page)
  await page.route('**/rest/v1/honors_earned?**', (r) =>
    r.fulfill({
      json: [
        { id: 1, year_earned: '2025-26', honors: { name: 'Zoology', is_master_award: false } },
        { id: 6, year_earned: '2025-26', honors: { name: 'Archery', is_master_award: false } },
        { id: 2, year_earned: null, honors: { name: 'Abseiling', is_master_award: false } },
        {
          id: 3,
          year_earned: '2022-23',
          honors: { name: 'Camping Skills I', is_master_award: false },
        },
        {
          id: 4,
          year_earned: '2024-25',
          honors: { name: 'Camping Skills I', is_master_award: false },
        },
        {
          id: 5,
          year_earned: '2020-21',
          honors: { name: 'Artisan Master Award', is_master_award: true },
        },
      ],
    }),
  )
  let attempts = 0
  await page.route('**/rest/v1/rpc/get_master_award_status', (r) => {
    attempts++
    expect(r.request().postDataJSON()).toEqual({ p_pathfinder_id: 2 })
    return attempts === 1
      ? r.fulfill({ status: 503, json: { message: 'Awards temporarily unavailable' } })
      : r.fulfill({
          json: [
            {
              honor_id: 600,
              name: 'Artisan Master Award',
              earned_years: ['2020-21'],
              eligible: false,
            },
            { honor_id: 601, name: 'Aquatic Master Award', earned_years: [], eligible: true },
          ],
        })
  })
  await page.getByRole('button', { name: 'Open profile for Justin Wu' }).click()
  await page.getByRole('button', { name: 'View Honors' }).click()
  const dialog = page.getByRole('dialog', { name: 'Honors', exact: true })
  await expect(dialog.getByRole('alert')).toContainText('Awards temporarily unavailable')
  await dialog.getByRole('button', { name: 'Retry honors' }).click()
  await expect(dialog.locator('.honors-year-list li')).toHaveText([
    'Camping Skills I',
    'Camping Skills I',
    'Archery',
    'Zoology',
    'Abseiling',
  ])
  await expect(dialog.locator('dt')).toHaveText(['2022-23', '2024-25', '2025-26', 'Unknown'])
  await expect(
    dialog.getByRole('list', { name: 'Honors earned 2025-26' }).locator('li'),
  ).toHaveText(['Archery', 'Zoology'])
  const awards = dialog.getByRole('region', { name: 'Master Award', exact: true })
  await expect(awards.locator('li')).toHaveText([
    'Aquatic Master AwardEligible — not yet earned',
    'Artisan Master AwardEarned — 2020-21',
  ])
  const gap = await awards.evaluate((element) => parseFloat(getComputedStyle(element).marginTop))
  expect(gap).toBeGreaterThanOrEqual(24)
  await page.screenshot({ path: 'test-results/honors-and-master-awards.png', fullPage: true })
})

test('Edit Profile selects a Master Award with the grouped picker and saves an explicit earned record', async ({
  page,
}) => {
  const { editor, profile } = await setupEditor(page)
  let lookups = 0
  await page.route('**/rest/v1/honors?**', (r) => {
    lookups++
    return r.fulfill({
      json: [{ id: 600, name: 'Aquatic Master Award', category: 'Master Award' }],
    })
  })
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Edit Honors', exact: true }).click()
  const honorsEditor = page.getByRole('dialog', { name: 'Edit Honors', exact: true })
  const honorSection = honorsEditor.getByRole('region', { name: 'Honors', exact: true })
  const input = honorSection.getByRole('combobox', { name: 'Find an honor' })
  await input.click()
  await page.waitForTimeout(300)
  expect(lookups).toBe(0)
  await expect(
    honorSection.getByRole('button', { name: 'Remove Camping Skills I from Find an honor' }),
  ).toBeVisible()
  await input.fill('Aquatic')
  await expect(honorSection.getByRole('group', { name: 'Master Award', exact: true })).toBeVisible()
  await honorSection.getByRole('option', { name: 'Aquatic Master Award', exact: true }).click()
  await honorsEditor.getByRole('button', { name: 'Back to Edit Profile' }).click()
  await expect(editor.getByRole('button', { name: 'Edit Honors', exact: true })).toBeFocused()
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Edit Honors', exact: true }).click()
  await expect(honorSection).toContainText('Aquatic Master Award')
  await page.keyboard.press('Escape')
  await expect(honorsEditor).toHaveCount(0)
  let saved: { p_original: unknown; p_profile: { honors_earned: unknown[] } } | undefined
  await page.route('**/rest/v1/rpc/update_profile', (r) => {
    saved = r.request().postDataJSON()
    return r.fulfill({ json: null })
  })
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Save Changes', exact: true }).click()
  const receipt = page.getByRole('dialog', { name: 'Confirm Profile Changes', exact: true })
  await expect(receipt).toContainText('Aquatic Master Award')
  await receipt.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(receipt).toHaveCount(0)
  expect(saved?.p_original).toEqual(profile)
  expect(saved?.p_profile.honors_earned).toEqual([{ id: 1, honor_id: 600, year_earned: '2023-24' }])
})

test('Staff history search pairs titles with years and closes selection menus', async ({
  page,
}) => {
  await setup(page)
  let catalogAttempts = 0
  await page.route('**/rest/v1/staff_titles?**', (route) => {
    catalogAttempts++
    return catalogAttempts === 1
      ? route.fulfill({ status: 500, json: { message: 'Catalog unavailable' } })
      : route.fulfill({ json: [{ title: 'Club Director' }, { title: 'Master Guide Leader' }] })
  })
  const years = page.getByRole('combobox', { name: 'Years', exact: true })
  await years.fill('2023-24')
  await years.press('Enter')
  await expect(years).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'Remove 2023-24 from Years' })).toBeVisible()
  await expect(years).toBeFocused()
  const level = page.getByRole('combobox', { name: 'Level Earned', exact: true })
  await level.fill('Master Guide')
  await expect(page.getByRole('option', { name: 'Master Guide', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: /Master Guide \/ / })).toHaveCount(0)
  await level.press('Enter')
  await expect(level).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('combobox', { name: 'History type' }).selectOption('staff')
  await expect(
    page.getByRole('button', { name: 'Remove Master Guide from Level Earned' }),
  ).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('Catalog unavailable')
  await page.getByRole('button', { name: 'Retry Staff titles' }).click()
  const titles = page.getByRole('combobox', { name: 'Staff Title', exact: true })
  await titles.click()
  await page.getByRole('option', { name: 'Club Director', exact: true }).click()
  await expect(titles).toHaveAttribute('aria-expanded', 'false')
  await expect(
    page.getByRole('button', { name: 'Remove Club Director from Staff Title' }),
  ).toBeVisible()
  await titles.fill('Master Guide Leader')
  await titles.press('Enter')
  await expect(titles).toHaveAttribute('aria-expanded', 'false')
  const request = page.waitForRequest((r) => r.url().includes('or='))
  await page.getByRole('button', { name: 'Search records' }).click()
  const expression = new URL((await request).url()).searchParams.get('or')!.replaceAll('\\"', '"')
  expect(expression).toContain('search_staff_titles.cs.')
  expect(expression).toContain('"name":"Club Director","year":"2023-24"')
  expect(expression).toContain('"name":"Master Guide Leader","year":"2023-24"')
  expect(expression).not.toContain('levels.cs.')
  expect(expression).not.toContain('outcome')
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByRole('combobox', { name: 'History type' })).toHaveValue('pathfinder')
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0)
})

test('Master Guide is added and displayed as an achievement with a year and no outcome', async ({
  page,
}) => {
  const { editor, profile } = await setupEditor(page)
  const masterGuide = (await editSection(page, 'Levels')).getByRole('region', {
    name: 'Master Guide',
    exact: true,
  })
  await expect(editor.getByLabel('Current Activities')).toHaveCount(0)
  await masterGuide.getByRole('button', { name: 'Add Master Guide' }).click()
  await expect(masterGuide.getByLabel('Outcome')).toHaveCount(0)
  await masterGuide.getByLabel('Year', { exact: true }).selectOption('2024-25')
  let saved = false
  await page.route('**/rest/v1/rpc/update_profile', async (route) => {
    const payload = route.request().postDataJSON()
    expect(payload.p_original).toEqual(profile)
    expect(payload.p_profile.pathfinders[0].levels).toContainEqual({
      name: 'Master Guide',
      year: '2024-25',
    })
    expect(payload.p_profile.current_data[0]).not.toHaveProperty('current_activities')
    saved = true
    await route.fulfill({ status: 204 })
  })
  await page.route('**/rest/v1/pathfinders?**', (route) =>
    route.fulfill({
      json: { ...fixture, levels: [...member.levels, { name: 'Master Guide', year: '2024-25' }] },
    }),
  )
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Save Changes' }).click()
  const receipt = page.getByRole('dialog', { name: 'Confirm Profile Changes' })
  await expect(receipt).toContainText('Master Guide')
  await expect(receipt).toContainText('2024-25')
  await expect(receipt).not.toContainText('Outcome')
  await receipt.getByRole('button', { name: 'Confirm', exact: true }).click()
  const overview = page.getByRole('dialog', { name: 'Member profile' })
  await expect(overview.locator('dd').filter({ hasText: /^Master Guide$/ })).toBeVisible()
  expect(saved).toBe(true)
  await expect(overview).not.toContainText('Master Guide (')
})

test('Add to Record submits Master Guide without an outcome and permits an unknown year', async ({
  page,
}) => {
  await setup(page)
  await page.route('**/rest/v1/rpc/current_club_year', (r) => r.fulfill({ json: '2026-27' }))
  await page.route('**/rest/v1/staff_titles?**', (r) =>
    r.fulfill({ json: [{ title: 'Club Director' }] }),
  )
  await page.route('**/rest/v1/pbe_year_books?**', (r) => r.fulfill({ json: [] }))
  await page.getByRole('button', { name: 'Add to Record', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add to Record', exact: true })
  const year = dialog.getByRole('combobox', { name: 'Year to document' })
  await year.fill('Unknown')
  await year.press('Enter')
  const achievement = dialog.getByRole('combobox', { name: 'Class', exact: true })
  await achievement.fill('Master Guide')
  await achievement.press('Enter')
  await expect(dialog.getByRole('combobox', { name: 'Outcome' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Select profiles', exact: true }).click()
  await dialog.getByRole('checkbox', { name: 'Select Justin Wu', exact: true }).check()
  await dialog.getByRole('button', { name: 'Finish / Done' }).click()
  const request = page.waitForRequest((r) => r.url().includes('/rpc/add_to_records'))
  await page.route('**/rest/v1/rpc/add_to_records', (r) =>
    r.fulfill({ json: [{ id: 2, name: 'Justin Wu', status: 'added', year_added: false }] }),
  )
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  expect((await request).postDataJSON()).toEqual({
    p_ids: [2],
    p_year: null,
    p_entry: { kind: 'level', name: 'Master Guide' },
  })
  await expect(page.getByRole('dialog')).toContainText('Added (1)')
})

test('Edit Profile confirms once, updates history and returns to the refreshed profile', async ({
  page,
}) => {
  const { editor, profile } = await setupEditor(page)
  let payload:
    | {
        p_original: unknown
        p_profile: {
          pathfinders: { notes: string }[]
          red_zone_burning_twine: { placement: string }[]
          staff_history: unknown
        }
      }
    | undefined
  let release: (() => void) | undefined
  await page.route('**/rest/v1/rpc/update_profile', async (r) => {
    payload = r.request().postDataJSON()
    await new Promise<void>((resolve) => {
      release = resolve
    })
    await r.fulfill({ status: 204 })
  })
  await editor.getByLabel('First Name', { exact: true }).fill('Alex')
  await editor.getByLabel('Notes', { exact: true }).fill('Updated paragraph.\n\nMore notes.')
  await (await editSection(page, 'Burning Twine')).getByLabel('Placement').selectOption('2nd Place')
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Save Changes', exact: true }).click()
  expect(payload).toBeUndefined()
  await page
    .getByRole('dialog', { name: 'Confirm Profile Changes' })
    .getByRole('button', { name: 'Confirm', exact: true })
    .click()
  await expect(
    page
      .getByRole('dialog', { name: 'Confirm Profile Changes' })
      .getByRole('button', { name: 'Back to Edit', exact: true }),
  ).toBeDisabled()
  await expect.poll(() => !!release).toBe(true)
  expect(payload!.p_original).toEqual(profile)
  expect(payload!.p_profile.pathfinders[0].notes).toBe('Updated paragraph.\n\nMore notes.')
  expect(payload!.p_profile.red_zone_burning_twine[0].placement).toBe('2nd Place')
  expect(payload!.p_profile.staff_history).toEqual(profile.staff_history)
  await page.route('**/rest/v1/pathfinders?**', (r) =>
    r.fulfill({
      json: {
        ...fixture,
        first_name: 'Alex',
        notes: 'Updated paragraph.\n\nMore notes.',
        red_zone_burning_twine: [{ year: '2023-24', placement: '2nd Place' }],
      },
    }),
  )
  await page.route('**/rest/v1/member_search?**', (r) =>
    r.fulfill({
      json: [{ ...member, first_name: 'Alex', name: 'Alex Wu' }],
      headers: { 'content-range': '0-0/1' },
    }),
  )
  release!()
  await expect(editor).toHaveCount(0)
  const profileDialog = page.getByRole('dialog', { name: 'Member profile', exact: true })
  await expect(profileDialog.getByRole('heading', { name: 'Alex Wu', exact: true })).toBeVisible()
  await expect(profileDialog.getByRole('region', { name: 'Notes' })).toContainText(
    'Updated paragraph.',
  )
  await expect(profileDialog).toContainText('2nd Place')
  await profileDialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open profile for Alex Wu' })).toBeVisible()
})

test('Edit Profile receipt keeps failed edits and supports going back without saving', async ({
  page,
}) => {
  const { editor } = await setupEditor(page)
  let writes = 0
  await page.route('**/rest/v1/rpc/update_profile', (r) => {
    writes++
    return r.fulfill({
      status: 409,
      json: { message: 'This profile changed since you opened the editor.' },
    })
  })
  await editor.getByLabel('Notes', { exact: true }).fill('Keep my draft')
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Save Changes', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Confirm Profile Changes' })
  await expect(review.getByRole('region', { name: 'Updated' })).toContainText('Keep my draft')
  await page.waitForTimeout(5100)
  await expect(review.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled()
  expect(writes).toBe(0)
  await review.getByRole('button', { name: 'Back to Edit' }).click()
  await editor.getByLabel('Last Name', { exact: true }).fill('Changed')
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect(review).toContainText('Changed')
  await review.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(review.getByRole('alert')).toContainText('This profile changed')
  expect(writes).toBe(1)
  await review.getByRole('button', { name: 'Back to Edit' }).click()
  await expect(editor.getByLabel('Notes', { exact: true })).toHaveValue('Keep my draft')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Member profile', exact: true })).toContainText(
    'Existing notes',
  )
})

test('Edit Profile fits mobile and loads safely after a retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { editor } = await setupEditor(page)
  await expect(editor.getByLabel('Notes', { exact: true })).toHaveValue('Existing notes')
  expect(await editor.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/edit-profile-mobile.png', fullPage: true })
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  let calls = 0
  await page.route('**/rest/v1/rpc/get_profile_for_edit', (r) => {
    calls++
    return r.fulfill({ status: 503, json: { message: 'Profile unavailable' } })
  })
  await page.getByRole('button', { name: 'Edit Profile', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('Profile unavailable')
  await expect(editor.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled()
  await editor.getByRole('button', { name: 'Retry Editor' }).click()
  await expect.poll(() => calls).toBe(2)
})

test('Edit Profile shows all classes, year dropdowns, automatic PBE books and new entries', async ({
  page,
}) => {
  const { editor } = await setupEditor(page)
  await expect(editor.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
  const header = editor.locator(':scope > header')
  await expect(header.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled()
  await expect(
    editor
      .getByRole('region', { name: 'Current Registration', exact: true })
      .getByRole('button', { name: /^Remove Current Registration Entry/ }),
  ).toHaveCount(0)
  const levels = await editSection(page, 'Levels')
  for (const name of [
    'Friend',
    'Companion',
    'Explorer',
    'Ranger',
    'Voyager',
    'Guide',
    'Pioneer',
    'Navigator',
  ]) {
    await expect(levels.getByRole('region', { name, exact: true })).toBeVisible()
  }
  const explorer = levels.getByRole('region', { name: 'Explorer', exact: true })
  await expect(explorer.getByLabel('Outcome')).toHaveValue('')
  await expect(
    explorer.getByLabel('Outcome').getByRole('option', { name: 'N/A', exact: true }),
  ).toHaveCount(1)
  await explorer.getByLabel('Outcome').selectOption('advanced')
  const year = explorer.getByLabel('Year', { exact: true })
  await expect(year.getByRole('option', { name: '2010-11', exact: true })).toHaveCount(1)
  await expect(year.getByRole('option', { name: '2009-10', exact: true })).toHaveCount(0)
  const current = new Date().getFullYear()
  await expect(
    year.getByRole('option', { name: `${current}-${String(current + 1).slice(-2)}`, exact: true }),
  ).toHaveCount(1)
  await year.selectOption('2024-25')
  const headings = await editor.locator('h3').allTextContents()
  expect(headings.indexOf('Current Registration')).toBeLessThan(headings.indexOf('Levels'))
  await expect(editor.locator('legend')).toHaveCount(0)
  const pbe = await editSection(page, 'PBE')
  await expect(pbe.getByRole('combobox', { name: 'Bible Books' })).toHaveCount(0)
  await expect(pbe).toContainText('1 Kings, Ruth')
  await pbe.getByRole('button', { name: 'Add PBE', exact: true }).click()
  // Free the existing year before assigning it to the new entry.
  await pbe.getByLabel('Year', { exact: true }).first().selectOption('')
  await pbe
    .locator('fieldset')
    .filter({ has: page.getByRole('button', { name: 'Remove PBE Entry 2', exact: true }) })
    .getByLabel('Year', { exact: true })
    .selectOption('2021-22')
  const drums = await editSection(page, 'Drums')
  await drums.getByRole('button', { name: 'Add Drums', exact: true }).click()
  await drums.getByLabel('Year', { exact: true }).last().selectOption('2024-25')
  const archery = await editSection(page, 'Archery')
  await archery.getByRole('button', { name: 'Add Archery', exact: true }).click()
  await archery.getByLabel('Year', { exact: true }).selectOption('2023-24')
  await archery.getByLabel('Placement').selectOption('1st Place')
  let payload: any
  await page.route('**/rest/v1/rpc/update_profile', (r) => {
    payload = r.request().postDataJSON()
    return r.fulfill({ status: 204 })
  })
  await returnToEditor(page)
  await header.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Confirm Profile Changes' })).not.toContainText(
    'Bible Books',
  )
  await expect(page.getByRole('dialog', { name: 'Confirm Profile Changes' })).not.toContainText(
    '1 Kings',
  )
  await page
    .getByRole('dialog', { name: 'Confirm Profile Changes' })
    .getByRole('button', { name: 'Confirm', exact: true })
    .click()
  await expect(editor).toHaveCount(0)
  expect(payload.p_profile.pathfinders[0].levels).toContainEqual({
    name: 'Explorer',
    outcome: 'advanced',
    year: '2024-25',
  })
  expect(payload.p_profile.pathfinders[0].levels.some((row: any) => row.outcome === 'N/A')).toBe(
    false,
  )
  expect(payload.p_profile.pbe[0].history[1].books).toEqual(['1 Kings', 'Ruth'])
  expect(payload.p_profile.drum_corps[0].history).toHaveLength(2)
  expect(payload.p_profile.red_zone_archery).toEqual([{ year: '2023-24', placement: '1st Place' }])
})

test('removing instances stays in the draft and appears in the confirmation receipt', async ({
  page,
}) => {
  const { editor } = await setupEditor(page)
  await expect(
    editor
      .getByRole('region', { name: 'Current Registration', exact: true })
      .getByRole('button', { name: /^Remove Current Registration Entry/ }),
  ).toHaveCount(0)
  const levels = await editSection(page, 'Levels')
  await expect(levels.getByRole('button', { name: /^Add / })).toHaveText(['Add Master Guide'])
  await levels.getByRole('button', { name: 'Remove Friend Entry', exact: true }).click()
  await expect(
    levels.getByRole('region', { name: 'Friend', exact: true }).getByLabel('Outcome'),
  ).toHaveValue('')
  await (
    await editSection(page, 'Drums')
  )
    .getByRole('button', { name: 'Remove Drums Entry 1', exact: true })
    .click()
  await expect((await editSection(page, 'Drums')).getByLabel('Year')).toHaveCount(0)
  await (
    await editSection(page, 'Burning Twine')
  )
    .getByRole('button', { name: 'Remove Burning Twine Entry 1', exact: true })
    .click()
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Edit Honors', exact: true }).click()
  const honorsEditor = page.getByRole('dialog', { name: 'Edit Honors', exact: true })
  await honorsEditor.getByRole('button', { name: 'Remove Honors Entry 1', exact: true }).click()
  await expect(honorsEditor).toContainText('No honors recorded.')
  await honorsEditor.getByRole('button', { name: 'Back to Edit Profile' }).click()
  const archery = await editSection(page, 'Archery')
  await archery.getByRole('button', { name: 'Add Archery', exact: true }).click()
  await archery.getByLabel('Year').selectOption('2024-25')
  await returnToEditor(page)
  await editor.getByLabel('Notes', { exact: true }).fill('Reviewed note')
  let payload: any
  await page.route('**/rest/v1/rpc/update_profile', (r) => {
    payload = r.request().postDataJSON()
    return r.fulfill({ status: 204 })
  })
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Save Changes', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Confirm Profile Changes' })
  expect(payload).toBeUndefined()
  await expect.poll(() => review.evaluate((node) => node.scrollTop)).toBe(0)
  const removed = review.getByRole('region', { name: 'Removed', exact: true })
  await expect(removed).toContainText('Friend')
  await expect(removed).toContainText('Drums')
  await expect(removed).toContainText('Snare')
  await expect(removed).toContainText('Burning Twine')
  await expect(removed).toContainText('Camping Skills I')
  await expect(review.getByRole('region', { name: 'Added', exact: true })).toContainText('Archery')
  await expect(review.getByRole('region', { name: 'Updated', exact: true })).toContainText(
    'Reviewed note',
  )
  await page.screenshot({ path: 'test-results/profile-change-receipt.png', fullPage: true })
  await review.getByRole('button', { name: 'Back to Edit' }).click()
  await expect((await editSection(page, 'Drums')).getByLabel('Year')).toHaveCount(0)
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await review.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(review).toHaveCount(0)
  expect(payload.p_profile.drum_corps).toEqual([])
  expect(payload.p_profile.red_zone_burning_twine).toEqual([])
  expect(payload.p_profile.honors_earned).toEqual([])
  expect(payload.p_profile.pathfinders[0].levels.some((row: any) => row.name === 'Friend')).toBe(
    false,
  )
})

test('missing current registration is shown automatically and saved with the profile', async ({
  page,
}) => {
  const { editor, profile } = await setupEditor(page)
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.route('**/rest/v1/rpc/get_profile_for_edit', (r) =>
    r.fulfill({ json: { ...profile, current_data: [] } }),
  )
  await page.route('**/rest/v1/rpc/current_club_year', (r) => r.fulfill({ json: '2026-27' }))
  await page.getByRole('button', { name: 'Edit Profile', exact: true }).click()
  const registration = editor.getByRole('region', { name: 'Current Registration', exact: true })
  await expect(registration.getByLabel('School Year')).toHaveValue('2026-27')
  await expect(registration.getByLabel('Status')).toHaveValue('not_active')
  await expect(
    registration.getByRole('button', { name: /^Remove Current Registration/ }),
  ).toHaveCount(0)
  let payload: any
  await page.route('**/rest/v1/rpc/update_profile', (r) => {
    payload = r.request().postDataJSON()
    return r.fulfill({ status: 204 })
  })
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Save Changes', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Confirm Profile Changes' })
  await expect(review.getByRole('region', { name: 'Added' })).toContainText('Current Registration')
  await review.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(review).toHaveCount(0)
  expect(payload.p_original.current_data).toEqual([])
  expect(payload.p_profile.current_data).toEqual([
    { school_year: '2026-27', status: 'not_active', current_title: null },
  ])
})

test('every profile history sorts years ascending and same-year details alphabetically', async ({
  page,
}) => {
  await setup(page)
  const years = ['2026-27', null, '2023-24']
  const history = years.flatMap((year) => [
    {
      year,
      titles: ['Zulu', 'Alpha'],
      drums: ['Snare', 'Bass'],
      operations: ['Teaching', 'Leadership'],
    },
  ])
  const events = Object.fromEntries(
    Object.keys(fixture)
      .filter((key) => key.startsWith('red_zone_'))
      .map((key) => [
        key,
        years.flatMap((year) => [
          { year, name: 'Zulu', placement: 'Participation' },
          { year, name: 'Alpha', placement: '1st Place' },
        ]),
      ]),
  )
  await page.route('**/rest/v1/pathfinders?**', (route) =>
    route.fulfill({
      json: {
        ...fixture,
        ...events,
        years_active: ['2026-27', '2023-24'],
        levels: years.flatMap((year) => [
          { year, name: 'Friend', outcome: 'basic' },
          { year, name: 'Companion', outcome: 'basic' },
        ]),
        staff_history: { history },
        drum_corps: { history },
        tlt: { history },
        drill: [
          { years, team: 'Precision' },
          { years, team: 'Adult' },
        ],
        pbe: {
          history: years.map((year) => ({
            year,
            books: [],
            results: { State: '1st Place', Area: 'Participation' },
          })),
        },
      },
    }),
  )
  await page.getByRole('button', { name: 'Open profile for Justin Wu' }).click()
  const profile = page.getByRole('dialog', { name: 'Member profile' })
  await expect(profile.locator('.profile-records')).toHaveCount(16)
  for (const records of await profile.locator('.profile-records').all()) {
    const rows = await records.locator(':scope > div').evaluateAll((elements) =>
      elements.map((element) => ({
        year: element.querySelector('dt')!.textContent!,
        detail: element.querySelector('dd')!.textContent!,
      })),
    )
    expect(rows.map((row) => row.year)).toContain('2026-27')
    expect(rows).toEqual(
      [...rows].sort(
        (a, b) =>
          (a.year === 'Unknown' ? '9999' : a.year).localeCompare(
            b.year === 'Unknown' ? '9999' : b.year,
          ) || a.detail.localeCompare(b.detail, undefined, { sensitivity: 'base' }),
      ),
    )
  }
  await expect(profile).toContainText('Alpha, Zulu')
  await expect(profile).toContainText('Bass, Snare')
  await expect(profile).toContainText('Leadership, Teaching')
  await expect(profile).toContainText('Area (P), State (1st)')
})

test('Edit Profile blocks duplicate entries and confirms sorted changes with Years Active', async ({
  page,
}) => {
  const { editor } = await setupEditor(page)
  const events = await editSection(page, 'Bible Events')
  let entryNumber = 0
  for (const [year, name] of [
    ['2026-27', 'Zulu'],
    ['2020-21', 'Zulu'],
    ['2020-21', 'Alpha'],
  ]) {
    await events.getByRole('button', { name: 'Add Bible Events', exact: true }).click()
    const entry = events.locator('fieldset').filter({
      has: page.getByRole('button', {
        name: `Remove Bible Events Entry ${++entryNumber}`,
        exact: true,
      }),
    })
    await entry.getByLabel('Year', { exact: true }).selectOption(year)
    await entry.getByLabel('Event / Evaluation Name').fill(name)
  }
  expect(
    await events
      .getByLabel('Year', { exact: true })
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLSelectElement).value)),
  ).toEqual(['2020-21', '2020-21', '2026-27'])
  expect(
    await events
      .getByLabel('Event / Evaluation Name')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value)),
  ).toEqual(['Alpha', 'Zulu', 'Zulu'])
  // Reject an edit that would duplicate another named event in the same year.
  await events.getByLabel('Event / Evaluation Name').first().fill('Zulu')
  await expect(editor.getByRole('alert')).toContainText('already exists')
  await expect(events.getByLabel('Event / Evaluation Name').first()).toHaveValue('Alpha')
  await expect(page.locator('.modal-footer').getByRole('alert')).toBeInViewport()
  const drums = await editSection(page, 'Drums')
  await drums.getByRole('button', { name: 'Add Drums', exact: true }).click()
  await drums.getByLabel('Year', { exact: true }).last().selectOption('2023-24')
  await expect(editor.getByRole('alert')).toContainText('already exists')
  await expect(drums.getByLabel('Year', { exact: true }).last()).not.toHaveValue('2023-24')
  await drums.getByRole('button', { name: 'Remove Drums Entry 2', exact: true }).click()
  let saved: any
  await page.route('**/rest/v1/rpc/update_profile', (route) => {
    saved = route.request().postDataJSON()
    return route.fulfill({ json: null })
  })
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Save Changes', exact: true }).click()
  const receipt = page.getByRole('dialog', { name: 'Confirm Profile Changes', exact: true })
  const changes = receipt
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Bible Events', exact: true }) })
  await expect(changes).toHaveText([
    'Bible EventsDetails: Year: 2020-21; Name: Alpha; Placement: Participation',
    'Bible EventsDetails: Year: 2020-21; Name: Zulu; Placement: Participation',
    'Bible EventsDetails: Year: 2026-27; Name: Zulu; Placement: Participation',
  ])
  await expect(
    receipt
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: 'Years Active', exact: true }) }),
  ).toContainText('2020-21, 2023-24, 2026-27')
  await receipt.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(receipt).toHaveCount(0)
  expect(saved.p_profile.pathfinders[0].years_active).toEqual(['2020-21', '2023-24', '2026-27'])
})

test('profile draft year and duplicate rules cover each documentation shape', async ({ page }) => {
  const { profile } = await setupEditor(page)
  const result = await page.evaluate(async (original) => {
    const modulePath = '/src/features/profile/profileDraft.ts'
    const { withDocumentedYears, introducesDuplicate } = await import(/* @vite-ignore */ modulePath)
    const draft = structuredClone(original) as any
    draft.pathfinders[0].levels.push({ name: 'Explorer', outcome: 'basic', year: '2010-11' })
    draft.staff_history[0].history.push({ year: '2011-12', titles: ['Club Director'] })
    draft.drill.push({ team: 'Freestyle', years: ['2012-13', null] })
    draft.drum_corps[0].history.push({ year: '2013-14', drums: ['Bass'] })
    draft.pbe[0].history.push({ year: '2014-15', books: [] })
    draft.tlt[0].history.push({ year: '2015-16', operations: ['Teaching'] })
    draft.red_zone_archery.push({ year: '2016-17', placement: 'Participation' })
    draft.honors_earned.push({ honor_id: 8, year_earned: '2017-18' })
    draft.honors_earned.push({ honor_id: 8, year_earned: null })
    const proposed = withDocumentedYears(original, draft)
    const duplicates = [
      'pathfinders',
      'staff_history',
      'drill',
      'drum_corps',
      'pbe',
      'tlt',
      'red_zone_archery',
      'honors_earned',
    ].map((table) => {
      const next = structuredClone(draft)
      if (table === 'pathfinders')
        next.pathfinders[0].levels.push({ ...next.pathfinders[0].levels[0] })
      else if (next[table][0]?.history)
        next[table][0].history.push({ ...next[table][0].history[0] })
      else {
        const row = { ...next[table][0] }
        delete row.id
        delete row.pathfinder_id
        next[table].push(row)
      }
      return introducesDuplicate(draft, next)
    })
    const removed = structuredClone(original) as any
    removed.pathfinders[0].levels = []
    removed.drill = []
    return {
      years: proposed.pathfinders[0].years_active,
      draftYears: draft.pathfinders[0].years_active,
      removedYears: withDocumentedYears(original, removed).pathfinders[0].years_active,
      duplicates,
      distinctYearsAllowed: !introducesDuplicate(original, draft),
    }
  }, profile)
  expect(result.years).toEqual([
    '2010-11',
    '2011-12',
    '2012-13',
    '2013-14',
    '2014-15',
    '2015-16',
    '2016-17',
    '2017-18',
    '2023-24',
  ])
  expect(result.draftYears).toEqual(['2023-24'])
  expect(result.removedYears).toEqual(['2023-24'])
  expect(result.duplicates).toEqual(Array(8).fill(true))
  expect(result.distinctYearsAllowed).toBe(true)
})

test('Edit Profile sorts loaded histories and honors without changing edit or removal targets', async ({
  page,
}) => {
  const { editor, profile } = await setupEditor(page)
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  profile.drum_corps[0].history = [
    { year: '2026-27', drums: ['Snare'] },
    { year: '2020-21', drums: ['Bass'] },
  ]
  profile.honors_earned = [
    { id: 1, honor_id: 8, year_earned: '2026-27' },
    { id: 2, honor_id: 8, year_earned: '2020-21' },
  ]
  await page.getByRole('button', { name: 'Edit Profile', exact: true }).click()
  const drums = await editSection(page, 'Drums')
  await expect(drums.getByLabel('Year', { exact: true }).first()).toHaveValue('2020-21')
  // Moving the early entry to Unknown moves it last, retaining its own instruments.
  await drums.getByLabel('Year', { exact: true }).first().selectOption('')
  await expect(drums.getByLabel('Year', { exact: true }).last()).toHaveValue('')
  await expect(drums.locator('fieldset').last()).toContainText('Bass')
  await drums.getByRole('button', { name: 'Remove Drums Entry 2', exact: true }).click()
  await expect(drums.locator('fieldset')).toHaveCount(1)
  await expect(drums).toContainText('Snare')
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Edit Honors', exact: true }).click()
  const honors = page.getByRole('dialog', { name: 'Edit Honors', exact: true })
  await expect(honors.getByLabel('Year', { exact: true }).first()).toHaveValue('2020-21')
  await honors.getByLabel('Year', { exact: true }).first().selectOption('2026-27')
  await expect(honors.getByRole('alert')).toContainText('already exists for this year')
  await expect(honors.getByRole('alert')).toBeInViewport()
  await honors.getByRole('button', { name: 'Remove Honors Entry 2', exact: true }).click()
  await expect(honors.getByLabel('Year', { exact: true })).toHaveValue('2026-27')
  await honors.getByRole('button', { name: 'Back to Edit Profile' }).click()
  let saved: any
  await page.route('**/rest/v1/rpc/update_profile', (route) => {
    saved = route.request().postDataJSON()
    return route.fulfill({ json: null })
  })
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Save Changes', exact: true }).click()
  const receipt = page.getByRole('dialog', { name: 'Confirm Profile Changes', exact: true })
  await receipt.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(receipt).toHaveCount(0)
  expect(saved.p_profile.honors_earned).toEqual([{ id: 1, honor_id: 8, year_earned: '2026-27' }])
  expect(saved.p_profile.drum_corps[0].history).toEqual([{ year: '2026-27', drums: ['Snare'] }])
})

test('new editor entries default to Unknown and allow multiple undated entries', async ({
  page,
}) => {
  const { editor } = await setupEditor(page)
  for (const name of ['Staff History', 'Drums', 'PBE', 'TLT', 'Archery']) {
    const section = await editSection(page, name)
    const count = await section.getByLabel('Year', { exact: true }).count()
    for (let i = 0; i < 2; i++) {
      await section.getByRole('button', { name: `Add ${name}`, exact: true }).click()
      await expect(section.getByLabel('Year', { exact: true }).last()).toHaveValue('')
    }
    await expect(section.getByLabel('Year', { exact: true })).toHaveCount(count + 2)
    await expect(page.locator('.modal-footer').getByRole('alert')).toHaveCount(0)
  }
  const drill = await editSection(page, 'Drill')
  await drill.getByRole('button', { name: 'Add Drill', exact: true }).click()
  await drill.getByRole('button', { name: 'Add Drill', exact: true }).click()
  await expect(drill.getByRole('button', { name: 'Remove Unknown from Years' })).toHaveCount(2)
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Edit Honors', exact: true }).click()
  const honors = page.getByRole('dialog', { name: 'Edit Honors', exact: true })
  await honors.getByRole('button', { name: 'Add Honors', exact: true }).click()
  await honors.getByRole('button', { name: 'Add Honors', exact: true }).click()
  await expect(honors.getByLabel('Year', { exact: true }).last()).toHaveValue('')
  await expect(honors.getByRole('alert')).toHaveCount(0)
})

test('Edit Honors validates empty entries before returning to Edit Profile', async ({ page }) => {
  const { editor } = await setupEditor(page)
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Edit Honors', exact: true }).click()
  const honors = page.getByRole('dialog', { name: 'Edit Honors', exact: true })
  await honors.getByRole('button', { name: 'Add Honors', exact: true }).click()
  await honors.getByRole('button', { name: 'Back to Edit Profile' }).click()
  await expect(honors).toBeVisible()
  await expect(honors.getByRole('alert')).toContainText('remove empty entries')
  await expect(honors.getByRole('alert')).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(honors).toBeVisible()
  await honors.getByRole('button', { name: 'Remove Honors Entry 2', exact: true }).click()
  await honors.getByRole('button', { name: 'Back to Edit Profile' }).click()
  await expect(honors).toHaveCount(0)
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Edit Honors', exact: true }).click()
  await honors.getByRole('button', { name: 'Add Honors', exact: true }).click()
  await honors.getByRole('button', { name: 'Back to Edit Profile' }).click()
  const entry = honors
    .locator('fieldset')
    .filter({ has: page.getByRole('button', { name: 'Remove Honors Entry 2', exact: true }) })
  await entry.getByRole('combobox', { name: 'Find an honor' }).fill('Camping')
  await entry.getByRole('option', { name: 'Camping Skills I', exact: true }).click()
  await expect(honors.getByRole('alert')).toHaveCount(0)
  await honors.getByRole('button', { name: 'Back to Edit Profile' }).click()
  await expect(honors).toHaveCount(0)
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Confirm Profile Changes', exact: true }),
  ).toContainText('Camping Skills I')
})

test('section pop-ups keep validation and duplicate warnings in a dismissible fixed footer', async ({
  page,
}) => {
  const { editor, profile } = await setupEditor(page)
  await expect(editor.getByRole('button', { name: /^Add / })).toHaveCount(0)
  const names = [
    'Levels',
    'Staff History',
    'Drill',
    'Drums',
    'PBE',
    'TLT',
    'Drill Performance',
    'Drum Performance',
    'Honor Evaluations',
    'Bible Events',
    'Knots Relay',
    'Tents',
    'Jump Rope',
    'Archery',
    'Lashing',
    'Burning Twine',
    'Honors',
  ]
  for (const name of names) {
    await editSection(page, name)
    await expect(
      page.getByRole('dialog', { name: `Edit ${name}`, exact: true }).locator('footer'),
    ).toBeInViewport()
    await returnToEditor(page)
    await expect(editor.getByRole('button', { name: `Edit ${name}`, exact: true })).toBeFocused()
  }
  const events = await editSection(page, 'Bible Events')
  await events.getByRole('button', { name: 'Add Bible Events', exact: true }).click()
  const eventDialog = page.getByRole('dialog', { name: 'Edit Bible Events', exact: true })
  await eventDialog.getByRole('button', { name: 'Back to Edit Profile' }).click()
  await expect(eventDialog.locator('footer').getByRole('alert')).toContainText(
    'Event / Evaluation Name',
  )
  await eventDialog.getByRole('heading', { name: 'Edit Bible Events', exact: true }).click()
  await expect(eventDialog.getByRole('alert')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(eventDialog.locator('footer').getByRole('alert')).toBeVisible()
  await events.getByLabel('Event / Evaluation Name').fill('New event')
  await returnToEditor(page)
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  profile.honors_earned = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    honor_id: 8,
    year_earned: '2023-24',
  }))
  await page.getByRole('button', { name: 'Edit Profile', exact: true }).click()
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 })
    const honors = await editSection(page, 'Honors')
    const dialog = page.getByRole('dialog', { name: 'Edit Honors', exact: true })
    await honors.getByRole('button', { name: 'Add Honors', exact: true }).click()
    await dialog.getByRole('button', { name: 'Back to Edit Profile' }).click()
    const warning = dialog.locator('footer').getByRole('alert')
    await expect(warning).toContainText('remove empty entries')
    for (const edge of ['top', 'bottom']) {
      await dialog.locator('.modal-body').evaluate((element, edge) => {
        element.scrollTop = edge === 'top' ? 0 : element.scrollHeight
      }, edge)
      await expect(warning).toBeInViewport()
      await expect(dialog.getByRole('button', { name: 'Back to Edit Profile' })).toBeInViewport()
    }
    await dialog.getByRole('heading', { name: 'Edit Honors', exact: true }).click()
    await expect(warning).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Back to Edit Profile' }).click()
    await expect(warning).toBeVisible()
    await dialog.getByRole('button', { name: 'Remove Honors Entry 41', exact: true }).click()
    // A same-year duplicate is still blocked, with its warning in the footer.
    await honors.getByRole('button', { name: 'Add Honors', exact: true }).click()
    const entry = honors
      .locator('fieldset')
      .filter({ has: page.getByRole('button', { name: 'Remove Honors Entry 41', exact: true }) })
    await entry.getByRole('combobox', { name: 'Find an honor' }).fill('Camping')
    await entry.getByRole('option', { name: 'Camping Skills I', exact: true }).click()
    await entry.getByLabel('Year', { exact: true }).selectOption('2023-24')
    await expect(warning).toContainText('already exists')
    await expect(warning).toBeInViewport()
    await page.screenshot({ path: `test-results/section-footer-${width}.png`, fullPage: true })
    await dialog.getByRole('heading', { name: 'Edit Honors', exact: true }).click()
    await expect(warning).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Remove Honors Entry 41', exact: true }).click()
    await returnToEditor(page)
  }
})
