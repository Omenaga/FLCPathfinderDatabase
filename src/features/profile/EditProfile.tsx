// Edit a local copy of a complete profile. Review changes before sending one atomic database update.

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Modal from '../../components/Modal'
import MultiSelect from '../../components/MultiSelect'
import HonorPicker, { type Honor } from '../add/HonorPicker'
import { getSupabase } from '../../lib/supabase'
import { message } from '../../lib/errors'
import { statusLabel } from '../../lib/format'
import {
  DRUMS,
  EVENTS,
  LEVELS,
  OPERATIONS,
  PBE_REGIONS,
  PERIODS,
  PLACEMENTS,
  STATUSES,
} from '../../lib/pathfinders'
import { profileChanges } from './profileChanges'
import type { Json } from '../../lib/database.types'

type Row = Record<string, Json>
// The edit RPC returns a snapshot keyed by table name, with each value containing that table's rows.
type Profile = Record<string, Row[]>
type Catalog = {
  staff: string[]
  books: { school_year: string; book_name: string }[]
  honors: Honor[]
}
// These suffixes follow the same order as EVENTS so labels map to the correct database tables.
const eventTables = [
  'drill_performance',
  'drum_performance',
  'honor_evaluations',
  'bible_events',
  'knots',
  'tents',
  'jump_rope',
  'archery',
  'lashing',
  'burning_twine',
]
// Convert JSON arrays to picker labels; null history years are presented as Unknown.
const strings = (value: Json | undefined) =>
  (Array.isArray(value) ? value : []).map((value) => (value === null ? 'Unknown' : String(value)))

export default function EditProfile({
  id,
  onClose,
  onSaved,
}: {
  id: number
  onClose: () => void
  onSaved: () => void
}) {
  const notesId = useId()
  const formId = useId()
  // Keep the loaded snapshot for change receipts and server-side stale-edit detection.
  const [original, setOriginal] = useState<Profile | null>(null)
  const [draft, setDraft] = useState<Profile | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  // A non-null review switches from editing to confirmation and holds the exact proposed save.
  const [review, setReview] = useState<Profile | null>(null)
  const sending = useRef(false)
  // Load the snapshot and label catalogs together; discard responses if the dialog closes or retries.
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const client = getSupabase()
        const [profile, staff, books, honors] = await Promise.all([
          client.rpc('get_profile_for_edit', { p_id: id }).abortSignal(controller.signal),
          client
            .from('staff_titles')
            .select('title')
            .order('sort_order')
            .abortSignal(controller.signal),
          client
            .from('pbe_year_books')
            .select('school_year,book_name')
            .abortSignal(controller.signal),
          client
            .from('honors_earned')
            .select('honors(id,name)')
            .eq('pathfinder_id', id)
            .abortSignal(controller.signal),
        ])
        for (const result of [profile, staff, books, honors]) if (result.error) throw result.error
        if (!controller.signal.aborted) {
          const value = profile.data as Profile
          const initial = structuredClone(value)
          // Supply a missing registration in the draft only; it is not written until the user confirms.
          if (!initial.current_data.length) {
            const season = await client.rpc('current_club_year').abortSignal(controller.signal)
            if (season.error) throw season.error
            initial.current_data = [
              {
                school_year: season.data,
                status: 'not_active',
                current_title: null,
              },
            ]
          }
          if (controller.signal.aborted) return
          setOriginal(value)
          setDraft(initial)
          setCatalog({
            staff: staff.data!.map((row) => row.title),
            books: books.data!,
            honors: honors.data!.map((row) => row.honors),
          })
        }
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(message(error))
      }
    }
    void load()
    return () => controller.abort()
  }, [id, attempt])
  // Merge a partial row edit immutably so React detects the change; invalidate any previous receipt.
  function change(table: string, index: number, patch: Row) {
    if (pending) return
    setDraft(
      (current) =>
        current && {
          ...current,
          [table]: current[table].map((row, i) => (i === index ? { ...row, ...patch } : row)),
        },
    )
    setReview(null)
    setError('')
  }
  // Append an unsaved row locally. The database assigns any required IDs during the confirmed save.
  function addRow(table: string, row: Row) {
    if (pending) return
    setDraft((current) => current && { ...current, [table]: [...current[table], row] })
    setReview(null)
    setError('')
  }
  // Use the catalog as the source of truth for the books associated with a PBE year.
  const booksFor = (year: Json) =>
    catalog?.books.filter((book) => book.school_year === year).map((book) => book.book_name) ?? []
  // Remove from the draft only; cancelling the editor leaves the database row untouched.
  function removeRow(table: string, index: number) {
    if (pending) return
    setDraft(
      (current) => current && { ...current, [table]: current[table].filter((_, i) => i !== index) },
    )
    setReview(null)
    setError('')
  }
  // Give each compact X button a descriptive accessible name for keyboard and screen-reader users.
  function removeButton(label: string, remove: () => void) {
    return (
      <div className="edit-entry-actions">
        <button
          type="button"
          className="secondary remove-entry"
          aria-label={`Remove ${label}`}
          title={`Remove ${label}`}
          onClick={remove}
        >
          &times;
        </button>
      </div>
    )
  }
  // Validate the draft and prepare a receipt. This form submission does not yet write to the database.
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft || !original || pending) return
    if (JSON.stringify(draft) === JSON.stringify(original)) return
    if (draft.honors_earned.some((row) => !row.honor_id)) {
      setError('Select an honor for each earned honor entry.')
      return
    }
    // Freeze the reviewed values; the receipt must describe exactly what will be saved.
    const proposed = structuredClone(draft)
    if (JSON.stringify(proposed.pbe) !== JSON.stringify(original.pbe)) {
      proposed.pbe = proposed.pbe.map((row) => ({
        ...row,
        history: (row.history as Row[]).map((entry) => ({
          ...entry,
          books: booksFor(entry.year).sort(),
        })),
      }))
    }
    setError('')
    setReview(proposed)
  }
  // The ref blocks rapid duplicate clicks before React can render the pending state.
  async function save() {
    if (!review || !original || sending.current) return
    sending.current = true
    setPending(true)
    setError('')
    try {
      const { error } = await getSupabase().rpc('update_profile', {
        p_id: id,
        p_original: original,
        p_profile: review,
      })
      if (error) throw error
      onSaved()
    } catch (error) {
      setError(message(error))
      setPending(false)
      sending.current = false
    }
  }
  // Render text/date inputs or a year selector; unknown optional dates and years are stored as null.
  function text(
    label: string,
    value: Json | undefined,
    update: (value: Json) => void,
    kind: 'text' | 'date' | 'year' = 'text',
    required = false,
  ) {
    if (kind === 'year')
      return (
        <label>
          {label}
          <select
            aria-label={label}
            value={String(value ?? '')}
            required={required}
            onChange={(e) => update(e.target.value || null)}
          >
            <option value="">{required ? 'Select Year' : 'Unknown'}</option>
            {[
              ...new Set([
                ...PERIODS,
                ...(value && !PERIODS.includes(String(value)) ? [String(value)] : []),
              ]),
            ].map((year) => (
              <option key={year}>{year}</option>
            ))}
          </select>
        </label>
      )
    return (
      <label>
        {label}
        <input
          type={kind === 'date' ? 'date' : 'text'}
          value={String(value ?? '')}
          required={required}
          maxLength={kind === 'text' ? 200 : undefined}
          pattern={required && kind === 'text' ? '.*\\S.*' : undefined}
          onChange={(e) => update(e.target.value || (kind !== 'text' && !required ? null : ''))}
        />
      </label>
    )
  }
  // Render one catalog choice, with an optional N/A entry that clears the stored value.
  function choice(
    label: string,
    value: Json | undefined,
    options: readonly string[],
    update: (value: Json) => void,
    optional = false,
  ) {
    return (
      <label key={label}>
        {label}
        <select
          aria-label={label}
          value={String(value ?? '')}
          required={!optional}
          onChange={(e) => update(e.target.value || null)}
        >
          {optional && <option value="">N/A</option>}
          {options.map((option) => (
            <option key={option} value={option}>
              {statusLabel(option)}
            </option>
          ))}
        </select>
      </label>
    )
  }
  // Keep existing values visible even if absent from today's catalog, and translate Unknown back to null.
  function multiple(
    label: string,
    value: Json | undefined,
    options: readonly string[],
    update: (value: Json) => void,
    nullableYears = false,
  ) {
    return (
      <MultiSelect
        label={label}
        values={strings(value)}
        options={[...new Set([...options, ...strings(value)])]}
        onChange={(values) =>
          update(
            nullableYears ? values.map((value) => (value === 'Unknown' ? null : value)) : values,
          )
        }
      />
    )
  }
  // Reuse the same add/update/remove controls for each table-backed history section.
  function rows(
    table: string,
    label: string,
    render: (row: Row, update: (patch: Row) => void) => ReactNode,
    create?: () => Row,
  ) {
    return (
      <section className="edit-section" key={table} aria-label={label}>
        <div className="section-heading">
          <h3>{label}</h3>
          {create && (
            <button type="button" className="secondary" onClick={() => addRow(table, create())}>
              Add {label}
            </button>
          )}
        </div>
        {draft?.[table]?.map((row, index) => (
          <fieldset
            className="edit-entry"
            key={String(row.id ?? row.pathfinder_id ?? `new-${index}`)}
          >
            {!['pathfinders', 'current_data'].includes(table) &&
              removeButton(`${label} Entry ${index + 1}`, () => removeRow(table, index))}
            <div className="record-fields">
              {render(row, (patch) => change(table, index, patch))}
            </div>
          </fieldset>
        ))}
      </section>
    )
  }
  // Staff, Drums, PBE, and TLT store yearly entries inside one row's history array.
  function history(
    table: string,
    label: string,
    detailKey: string,
    detailLabel: string,
    options: readonly string[],
  ) {
    const row = draft?.[table]?.[0]
    const entries = (row?.history ?? []) as Row[]
    // Start with the newest unused period; use an unknown year when all listed periods are occupied.
    function add() {
      const year =
        [...PERIODS].reverse().find((year) => !entries.some((entry) => entry.year === year)) ?? null
      const entry: Row = { year, [detailKey]: table === 'pbe' ? booksFor(year) : [] }
      if (row) change(table, 0, { history: [...entries, entry] })
      else addRow(table, { history: [entry] })
    }
    return (
      <section className="edit-section" aria-label={label}>
        <div className="section-heading">
          <h3>{label}</h3>
          <button type="button" className="secondary" onClick={add}>
            Add {label}
          </button>
        </div>
        {entries.map((entry, index) => {
          // Replace only the edited history instance, preserving the other entries within its parent row.
          const set = (patch: Row) =>
            change(table, 0, {
              history: entries.map((item, i) => (i === index ? { ...item, ...patch } : item)),
            })
          return (
            <fieldset className="edit-entry" key={index}>
              {removeButton(`${label} Entry ${index + 1}`, () => {
                if (entries.length === 1) removeRow(table, 0)
                else change(table, 0, { history: entries.filter((_, i) => i !== index) })
              })}
              <div className="record-fields">
                {text(
                  'Year',
                  entry.year,
                  (year) => set(table === 'pbe' ? { year, books: booksFor(year) } : { year }),
                  'year',
                )}
                {table === 'pbe' ? (
                  <div>
                    <span className="field-label">Bible Books</span>
                    <p>
                      {booksFor(entry.year).join(', ') ||
                        (entry.year === null ? 'Unknown Year' : 'No Books Configured')}
                    </p>
                  </div>
                ) : (
                  multiple(detailLabel, entry[detailKey], options, (value) =>
                    set({ [detailKey]: value }),
                  )
                )}
                {table === 'pbe' &&
                  PBE_REGIONS.map((region) =>
                    choice(
                      region,
                      (entry.results as Row | undefined)?.[region],
                      PLACEMENTS,
                      (value) => {
                        const results = { ...(entry.results as Row) }
                        if (value) results[region] = value
                        else delete results[region]
                        set({ results })
                      },
                      true,
                    ),
                  )}
              </div>
            </fieldset>
          )
        })}
      </section>
    )
  }
  // Show every class, including unrecorded ones, without storing placeholder rows in the draft.
  function levels() {
    const entries = (draft!.pathfinders[0].levels ?? []) as Row[]
    const update = (value: Row[]) => change('pathfinders', 0, { levels: value })
    return (
      <section className="edit-section" aria-label="Levels">
        <h3>Levels</h3>
        {LEVELS.map((name) => {
          const matches = entries
            .map((entry, index) => ({ entry, index }))
            .filter(({ entry }) => entry.name === name)
          // Index -1 marks a display-only placeholder; selecting an outcome turns it into a real entry.
          const shown = matches.length
            ? matches
            : [{ entry: { name, outcome: null, year: null } as Row, index: -1 }]
          return (
            <section key={name} aria-label={name} className="edit-class">
              <div className="section-heading">
                <h4>{name}</h4>
              </div>
              {shown.map(({ entry, index }) => (
                <fieldset className="edit-entry" key={index}>
                  {index >= 0 &&
                    removeButton(`${name} Entry`, () =>
                      update(entries.filter((_, i) => i !== index)),
                    )}
                  <div className="record-fields">
                    {choice(
                      'Outcome',
                      entry.outcome,
                      ['basic', 'advanced', 'incomplete'],
                      (value) => {
                        if (!value) update(entries.filter((_, i) => i !== index))
                        else if (index < 0) update([...entries, { ...entry, outcome: value }])
                        else
                          update(
                            entries.map((item, i) =>
                              i === index ? { ...item, outcome: value } : item,
                            ),
                          )
                      },
                      true,
                    )}
                    {entry.outcome ? (
                      text(
                        'Year',
                        entry.year,
                        (value) =>
                          update(
                            entries.map((item, i) =>
                              i === index ? { ...item, year: value } : item,
                            ),
                          ),
                        'year',
                      )
                    ) : (
                      <label>
                        Year
                        <select disabled>
                          <option>N/A</option>
                        </select>
                      </label>
                    )}
                  </div>
                </fieldset>
              ))}
            </section>
          )
        })}
        {/* Master Guide records presence and year only; it is not a ninth outcome-based class. */}
        <section aria-label="Master Guide" className="edit-class">
          <div className="section-heading">
            <h4>Master Guide</h4>
            {!entries.some((entry) => entry.name === 'Master Guide') && (
              <button
                type="button"
                className="secondary"
                onClick={() => update([...entries, { name: 'Master Guide', year: null }])}
              >
                Add Master Guide
              </button>
            )}
          </div>
          {entries.map(
            (entry, index) =>
              entry.name === 'Master Guide' && (
                <fieldset className="edit-entry" key={index}>
                  {removeButton('Master Guide Entry', () =>
                    update(entries.filter((_, i) => i !== index)),
                  )}
                  {text(
                    'Year',
                    entry.year,
                    (value) =>
                      update(
                        entries.map((item, i) => (i === index ? { ...item, year: value } : item)),
                      ),
                    'year',
                  )}
                </fieldset>
              ),
          )}
        </section>
      </section>
    )
  }
  const changed = draft && original && JSON.stringify(draft) !== JSON.stringify(original)
  // The review screen replaces the form until confirmation or Back to Edit. Failed saves keep this snapshot.
  if (review && original && catalog) {
    const receipt = profileChanges(original, review, catalog.honors)
    return (
      <Modal
        title="Confirm Profile Changes"
        header={<h2>Confirm Profile Changes</h2>}
        onClose={() => setReview(null)}
        closeDisabled={pending}
        hideClose
        headerActions={
          <>
            <button type="button" disabled={pending || !receipt.length} onClick={() => void save()}>
              {pending ? 'Saving...' : 'Confirm'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={pending}
              onClick={() => {
                setReview(null)
                setError('')
              }}
            >
              Back to Edit
            </button>
          </>
        }
      >
        <p>
          Review the changes for{' '}
          <strong>
            {[review.pathfinders[0].first_name, review.pathfinders[0].last_name]
              .filter(Boolean)
              .join(' ')}
          </strong>
          . Nothing is saved until you click Confirm.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {pending && <p role="status">Saving Profile...</p>}
        {/* Separate the receipt by change type and omit empty groups. */}
        {(['Added', 'Updated', 'Removed'] as const).map((kind) => {
          const items = receipt.filter((item) => item.kind === kind)
          return (
            items.length > 0 && (
              <section className="profile-change-receipt" key={kind} aria-label={kind}>
                <h3>
                  {kind} ({items.length})
                </h3>
                {items.map((item, index) => (
                  <article key={index}>
                    <h4>{item.label}</h4>
                    {item.before !== undefined && (
                      <p>
                        <strong>Before: </strong>
                        {item.before}
                      </p>
                    )}
                    {item.after !== undefined && (
                      <p>
                        <strong>{kind === 'Added' ? 'Details' : 'After'}: </strong>
                        {item.after}
                      </p>
                    )}
                  </article>
                ))}
              </section>
            )
          )
        })}
      </Modal>
    )
  }
  return (
    <Modal
      title="Edit Profile"
      header={<h2>Edit Profile</h2>}
      onClose={onClose}
      closeDisabled={pending}
      hideClose
      headerActions={
        <>
          <button type="submit" form={formId} disabled={pending || !changed || !catalog}>
            Save Changes
          </button>
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={onClose}
            autoFocus
          >
            Cancel
          </button>
        </>
      }
    >
      {loadError ? (
        <>
          <p className="error" role="alert">
            {loadError}
          </p>
          <button
            onClick={() => {
              setLoadError('')
              setAttempt((value) => value + 1)
            }}
          >
            Retry Editor
          </button>
        </>
      ) : !draft || !catalog ? (
        <p role="status">Loading Profile Editor...</p>
      ) : (
        <form id={formId} className="record-form profile-editor" onSubmit={submit}>
          <p>
            Update details or add history below. Choose N/A for a class with no recorded outcome.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <p>Save Changes opens a receipt to review before confirming.</p>
          <fieldset className="record-fieldset" disabled={pending}>
            {rows('pathfinders', 'Personal Details', (row, update) => (
              <>
                {text(
                  'First Name',
                  row.first_name,
                  (value) => update({ first_name: value }),
                  'text',
                  true,
                )}
                {text('Last Name', row.last_name, (value) => update({ last_name: value }))}
                {text('Birthday', row.birth_date, (value) => update({ birth_date: value }), 'date')}
                {multiple('Years Active', row.years_active, PERIODS, (value) =>
                  update({ years_active: value }),
                )}
                <div className="edit-history">
                  <label htmlFor={notesId}>Notes</label>
                  <textarea
                    id={notesId}
                    rows={5}
                    value={String(row.notes ?? '')}
                    onChange={(e) => update({ notes: e.target.value })}
                    placeholder="Add a sentence or several paragraphs"
                  />
                </div>
              </>
            ))}
            {rows('current_data', 'Current Registration', (row, update) => (
              <>
                {text(
                  'School Year',
                  row.school_year,
                  (value) => update({ school_year: value }),
                  'year',
                  true,
                )}
                {choice(
                  'Status',
                  row.status,
                  STATUSES.map((status) => status.toLowerCase().replaceAll(' ', '_')),
                  (value) =>
                    update({
                      status: value,
                      current_title: null,
                    }),
                )}
                {(row.status === 'staff' || row.status === 'pathfinder') &&
                  multiple(
                    'Class/Titles',
                    row.current_title,
                    row.status === 'staff' ? catalog.staff : LEVELS,
                    (value) => update({ current_title: value }),
                  )}
              </>
            ))}
            {levels()}
            {history('staff_history', 'Staff History', 'titles', 'Titles', catalog.staff)}
            {rows(
              'drill',
              'Drill',
              (row, update) => (
                <>
                  {choice(
                    'Team',
                    row.team,
                    ['Precision', 'Freestyle', 'Adult'],
                    (value) => update({ team: value }),
                    true,
                  )}
                  {multiple(
                    'Years',
                    row.years,
                    [...PERIODS, 'Unknown'],
                    (value) => update({ years: value }),
                    true,
                  )}
                </>
              ),
              () => ({ team: null, years: [PERIODS.at(-1)!] }),
            )}
            {history('drum_corps', 'Drums', 'drums', 'Instruments', DRUMS)}
            {history('pbe', 'PBE', 'books', 'Bible Books', [])}
            {history('tlt', 'TLT', 'operations', 'Operations', OPERATIONS)}
            {eventTables.map((table, index) =>
              rows(
                `red_zone_${table}`,
                EVENTS[index],
                (row, update) => (
                  <>
                    {text('Year', row.year, (value) => update({ year: value }), 'year')}
                    {choice('Placement', row.placement, PLACEMENTS, (value) =>
                      update({ placement: value }),
                    )}
                    {'name' in row &&
                      text(
                        'Event / Evaluation Name',
                        row.name,
                        (value) => update({ name: value }),
                        'text',
                        true,
                      )}
                  </>
                ),
                () => ({
                  year: PERIODS.at(-1)!,
                  placement: 'Participation',
                  ...(['honor_evaluations', 'bible_events'].includes(table) ? { name: '' } : {}),
                }),
              ),
            )}
            {rows(
              'honors_earned',
              'Honors',
              (row, update) => (
                <>
                  {text('Year', row.year_earned, (value) => update({ year_earned: value }), 'year')}
                  <HonorPicker
                    value={catalog.honors.find((honor) => honor.id === row.honor_id) ?? null}
                    onChange={(honor) => {
                      if (honor)
                        setCatalog(
                          (current) =>
                            current && {
                              ...current,
                              honors: [
                                ...current.honors.filter((item) => item.id !== honor.id),
                                honor,
                              ],
                            },
                        )
                      update({ honor_id: honor?.id ?? null })
                    }}
                  />
                </>
              ),
              () => ({ honor_id: null, year_earned: PERIODS.at(-1)! }),
            )}
          </fieldset>
        </form>
      )}
    </Modal>
  )
}
