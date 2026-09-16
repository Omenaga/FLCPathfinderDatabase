import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Modal from '../../components/Modal'
import MultiSelect from '../../components/MultiSelect'
import HonorPicker, { type Honor } from '../add/HonorPicker'
import { getSupabase } from '../../lib/supabase'
import { message } from '../../lib/errors'
import { statusLabel } from '../../lib/format'
import { ACTIVITIES, DRUMS, EVENTS, LEVELS, OPERATIONS, PBE_REGIONS, PERIODS, PLACEMENTS, STATUSES } from '../../lib/pathfinders'
import { profileChanges } from './profileChanges'
import type { Json } from '../../lib/database.types'

type Row = Record<string, Json>
type Profile = Record<string, Row[]>
type Catalog = { staff: string[]; books: { school_year: string; book_name: string }[]; honors: Honor[] }
const eventTables = ['drill_performance', 'drum_performance', 'honor_evaluations', 'bible_events', 'knots', 'tents', 'jump_rope', 'archery', 'lashing', 'burning_twine']
const strings = (value: Json | undefined) => (Array.isArray(value) ? value : []).map(value => value === null ? 'Unknown' : String(value))

export default function EditProfile({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: () => void }) {
  const notesId = useId()
  const formId = useId()
  const [original, setOriginal] = useState<Profile | null>(null)
  const [draft, setDraft] = useState<Profile | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [review, setReview] = useState<Profile | null>(null)
  const sending = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const client = getSupabase()
        const [profile, staff, books, honors] = await Promise.all([
          client.rpc('get_profile_for_edit', { p_id: id }).abortSignal(controller.signal),
          client.from('staff_titles').select('title').order('sort_order').abortSignal(controller.signal),
          client.from('pbe_year_books').select('school_year,book_name').abortSignal(controller.signal),
          client.from('honors_earned').select('honors(id,name)').eq('pathfinder_id', id).abortSignal(controller.signal),
        ])
        for (const result of [profile, staff, books, honors]) if (result.error) throw result.error
        if (!controller.signal.aborted) {
          const value = profile.data as Profile
          setOriginal(value); setDraft(structuredClone(value))
          setCatalog({ staff: staff.data!.map(row => row.title), books: books.data!, honors: honors.data!.map(row => row.honors) })
        }
      } catch (error) { if (!controller.signal.aborted) setLoadError(message(error)) }
    }
    void load()
    return () => controller.abort()
  }, [id, attempt])
  function change(table: string, index: number, patch: Row) {
    if (pending) return
    setDraft(current => current && ({ ...current, [table]: current[table].map((row, i) => i === index ? { ...row, ...patch } : row) }))
    setReview(null); setError('')
  }
  function addRow(table: string, row: Row) {
    if (pending) return
    setDraft(current => current && ({ ...current, [table]: [...current[table], row] }))
    setReview(null); setError('')
  }
  const booksFor = (year: Json) => catalog?.books.filter(book => book.school_year === year).map(book => book.book_name) ?? []
  function removeRow(table: string, index: number) {
    if (pending) return
    setDraft(current => current && ({ ...current, [table]: current[table].filter((_, i) => i !== index) }))
    setReview(null); setError('')
  }
  function removeButton(label: string, remove: () => void) {
    return <div className="edit-entry-actions"><button type="button" className="secondary remove-entry" aria-label={`Remove ${label}`} title={`Remove ${label}`} onClick={remove}>&times;</button></div>
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft || !original || pending) return
    if (JSON.stringify(draft) === JSON.stringify(original)) return
    if (draft.honors_earned.some(row => !row.honor_id)) { setError('Select an honor for each earned honor entry.'); return }
    const proposed = structuredClone(draft)
    if (JSON.stringify(proposed.pbe) !== JSON.stringify(original.pbe)) {
      proposed.pbe = proposed.pbe.map(row => ({ ...row, history: (row.history as Row[]).map(entry => ({ ...entry, books: booksFor(entry.year).sort() })) }))
    }
    setError(''); setReview(proposed)
  }
  async function save() {
    if (!review || !original || sending.current) return
    sending.current = true; setPending(true); setError('')
    try {
      const { error } = await getSupabase().rpc('update_profile', { p_id: id, p_original: original, p_profile: review })
      if (error) throw error
      onSaved()
    } catch (error) { setError(message(error)); setPending(false); sending.current = false }
  }
  function text(label: string, value: Json | undefined, update: (value: Json) => void, kind: 'text' | 'date' | 'year' = 'text', required = false) {
    if (kind === 'year') return <label>{label}<select aria-label={label} value={String(value ?? '')} required={required} onChange={e => update(e.target.value || null)}>
      <option value="">{required ? 'Select Year' : 'Unknown'}</option>
      {[...new Set([...PERIODS, ...(value && !PERIODS.includes(String(value)) ? [String(value)] : [])])].map(year => <option key={year}>{year}</option>)}
    </select></label>
    return <label>{label}<input type={kind === 'date' ? 'date' : 'text'} value={String(value ?? '')} required={required}
      maxLength={kind === 'text' ? 200 : undefined}
      pattern={required && kind === 'text' ? '.*\\S.*' : undefined}
      onChange={e => update(e.target.value || (kind !== 'text' && !required ? null : ''))} /></label>
  }
  function choice(label: string, value: Json | undefined, options: readonly string[], update: (value: Json) => void, optional = false) {
    return <label key={label}>{label}<select aria-label={label} value={String(value ?? '')} required={!optional} onChange={e => update(e.target.value || null)}>
      {optional && <option value="">N/A</option>}{options.map(option => <option key={option} value={option}>{statusLabel(option)}</option>)}
    </select></label>
  }
  function multiple(label: string, value: Json | undefined, options: readonly string[], update: (value: Json) => void, nullableYears = false) {
    return <MultiSelect label={label} values={strings(value)} options={[...new Set([...options, ...strings(value)])]} onChange={values => update(nullableYears ? values.map(value => value === 'Unknown' ? null : value) : values)} />
  }
  function rows(table: string, label: string, render: (row: Row, update: (patch: Row) => void) => ReactNode, create?: () => Row) {
    return <section className="edit-section" key={table} aria-label={label}><div className="section-heading"><h3>{label}</h3>
      {create && <button type="button" className="secondary" onClick={() => addRow(table, create())}>Add {label}</button>}
    </div>{draft?.[table]?.map((row, index) => <fieldset className="edit-entry" key={String(row.id ?? row.pathfinder_id ?? `new-${index}`)}>
      {table !== 'pathfinders' && removeButton(`${label} Entry ${index + 1}`, () => removeRow(table, index))}
      <div className="record-fields">{render(row, patch => change(table, index, patch))}</div>
    </fieldset>)}</section>
  }
  function history(table: string, label: string, detailKey: string, detailLabel: string, options: readonly string[]) {
    const row = draft?.[table]?.[0]
    const entries = (row?.history ?? []) as Row[]
    function add() {
      const year = [...PERIODS].reverse().find(year => !entries.some(entry => entry.year === year)) ?? null
      const entry: Row = { year, [detailKey]: table === 'pbe' ? booksFor(year) : [] }
      if (row) change(table, 0, { history: [...entries, entry] })
      else addRow(table, { history: [entry] })
    }
    return <section className="edit-section" aria-label={label}><div className="section-heading"><h3>{label}</h3>
      <button type="button" className="secondary" onClick={add}>Add {label}</button></div>
      {entries.map((entry, index) => {
        const set = (patch: Row) => change(table, 0, { history: entries.map((item, i) => i === index ? { ...item, ...patch } : item) })
        return <fieldset className="edit-entry" key={index}>
          {removeButton(`${label} Entry ${index + 1}`, () => {
            if (entries.length === 1) removeRow(table, 0)
            else change(table, 0, { history: entries.filter((_, i) => i !== index) })
          })}<div className="record-fields">
          {text('Year', entry.year, year => set(table === 'pbe' ? { year, books: booksFor(year) } : { year }), 'year')}
          {table === 'pbe' ? <div><span className="field-label">Bible Books</span><p>{booksFor(entry.year).join(', ') || (entry.year === null ? 'Unknown Year' : 'No Books Configured')}</p></div>
            : multiple(detailLabel, entry[detailKey], options, value => set({ [detailKey]: value }))}
          {table === 'pbe' && PBE_REGIONS.map(region => choice(region, (entry.results as Row | undefined)?.[region], PLACEMENTS, value => {
            const results = { ...entry.results as Row }
            if (value) results[region] = value
            else delete results[region]
            set({ results })
          }, true))}
        </div></fieldset>
      })}
    </section>
  }
  function levels() {
    const entries = (draft!.pathfinders[0].levels ?? []) as Row[]
    const update = (value: Row[]) => change('pathfinders', 0, { levels: value })
    return <section className="edit-section" aria-label="Levels"><h3>Levels</h3>{LEVELS.map(name => {
      const matches = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.name === name)
      const shown = matches.length ? matches : [{ entry: { name, outcome: null, year: null } as Row, index: -1 }]
      return <section key={name} aria-label={name} className="edit-class"><div className="section-heading"><h4>{name}</h4>
        </div>
        {shown.map(({ entry, index }) => <fieldset className="edit-entry" key={index}>
          {index >= 0 && removeButton(`${name} Entry`, () => update(entries.filter((_, i) => i !== index)))}<div className="record-fields">
          {choice('Outcome', entry.outcome, ['basic', 'advanced', 'incomplete'], value => {
            if (!value) update(entries.filter((_, i) => i !== index))
            else if (index < 0) update([...entries, { ...entry, outcome: value }])
            else update(entries.map((item, i) => i === index ? { ...item, outcome: value } : item))
          }, true)}
          {entry.outcome ? text('Year', entry.year, value => update(entries.map((item, i) => i === index ? { ...item, year: value } : item)), 'year')
            : <label>Year<select disabled><option>N/A</option></select></label>}
        </div></fieldset>)}
      </section>
    })}</section>
  }
  const changed = draft && original && JSON.stringify(draft) !== JSON.stringify(original)
  if (review && original && catalog) {
    const receipt = profileChanges(original, review, catalog.honors)
    return <Modal title="Confirm Profile Changes" header={<h2>Confirm Profile Changes</h2>} onClose={() => setReview(null)} closeDisabled={pending} hideClose headerActions={<>
      <button type="button" disabled={pending || !receipt.length} onClick={() => void save()}>{pending ? 'Saving...' : 'Confirm'}</button>
      <button type="button" className="secondary" disabled={pending} onClick={() => { setReview(null); setError('') }}>Back to Edit</button>
    </>}>
      <p>Review the changes for <strong>{[review.pathfinders[0].first_name, review.pathfinders[0].last_name].filter(Boolean).join(' ')}</strong>. Nothing is saved until you click Confirm.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {pending && <p role="status">Saving Profile...</p>}
      {(['Added', 'Updated', 'Removed'] as const).map(kind => {
        const items = receipt.filter(item => item.kind === kind)
        return items.length > 0 && <section className="profile-change-receipt" key={kind} aria-label={kind}><h3>{kind} ({items.length})</h3>
          {items.map((item, index) => <article key={index}><h4>{item.label}</h4>
            {item.before !== undefined && <p><strong>Before: </strong>{item.before}</p>}
            {item.after !== undefined && <p><strong>{kind === 'Added' ? 'Details' : 'After'}: </strong>{item.after}</p>}
          </article>)}
        </section>
      })}
    </Modal>
  }
  return <Modal title="Edit Profile" header={<h2>Edit Profile</h2>} onClose={onClose} closeDisabled={pending} hideClose headerActions={<>
    <button type="submit" form={formId} disabled={pending || !changed || !catalog}>Save Changes</button>
    <button type="button" className="secondary" disabled={pending} onClick={onClose} autoFocus>Cancel</button>
  </>}>
    {loadError ? <><p className="error" role="alert">{loadError}</p><button onClick={() => { setLoadError(''); setAttempt(value => value + 1) }}>Retry Editor</button></> : !draft || !catalog ? <p role="status">Loading Profile Editor...</p> :
      <form id={formId} className="record-form profile-editor" onSubmit={submit}>
        <p>Update details or add history below. Choose N/A for a class with no recorded outcome.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <p>Save Changes opens a receipt to review before confirming.</p>
        <fieldset className="record-fieldset" disabled={pending}>
          {rows('pathfinders', 'Personal Details', (row, update) => <>
            {text('First Name', row.first_name, value => update({ first_name: value }), 'text', true)}
            {text('Last Name', row.last_name, value => update({ last_name: value }))}
            {text('Birthday', row.birth_date, value => update({ birth_date: value }), 'date')}
            {multiple('Years Active', row.years_active, PERIODS, value => update({ years_active: value }))}
            <div className="edit-history"><label htmlFor={notesId}>Notes</label><textarea id={notesId} rows={5} value={String(row.notes ?? '')} onChange={e => update({ notes: e.target.value })} placeholder="Add a sentence or several paragraphs" /></div>
          </>)}
          {rows('current_data', 'Current Registration', (row, update) => <>
            {text('School Year', row.school_year, value => update({ school_year: value }), 'year', true)}
            {choice('Status', row.status, STATUSES.map(status => status.toLowerCase().replaceAll(' ', '_')), value => update({ status: value, current_title: null, current_activities: value === 'staff' ? ['N/A'] : [] }))}
            {(row.status === 'staff' || row.status === 'pathfinder') && multiple('Class/Titles', row.current_title, row.status === 'staff' ? catalog.staff : LEVELS, value => update({ current_title: value }))}
            {row.status !== 'staff' && multiple('Current Activities', row.current_activities, ACTIVITIES, value => update({ current_activities: value }))}
          </>, draft.current_data.length ? undefined : () => ({ school_year: PERIODS.at(-1)!, status: 'not_active', current_title: null, current_activities: [] }))}
          {levels()}
          {history('staff_history', 'Staff History', 'titles', 'Titles', catalog.staff)}
          {rows('drill', 'Drill', (row, update) => <>
            {choice('Team', row.team, ['Precision', 'Freestyle', 'Adult'], value => update({ team: value }), true)}
            {multiple('Years', row.years, [...PERIODS, 'Unknown'], value => update({ years: value }), true)}
          </>, () => ({ team: null, years: [PERIODS.at(-1)!] }))}
          {history('drum_corps', 'Drums', 'drums', 'Instruments', DRUMS)}
          {history('pbe', 'PBE', 'books', 'Bible Books', [])}
          {history('tlt', 'TLT', 'operations', 'Operations', OPERATIONS)}
          {eventTables.map((table, index) => rows(`red_zone_${table}`, EVENTS[index], (row, update) => <>
            {text('Year', row.year, value => update({ year: value }), 'year')}
            {choice('Placement', row.placement, PLACEMENTS, value => update({ placement: value }))}
            {'name' in row && text('Event / Evaluation Name', row.name, value => update({ name: value }), 'text', true)}
          </>, () => ({ year: PERIODS.at(-1)!, placement: 'Participation', ...(['honor_evaluations', 'bible_events'].includes(table) ? { name: '' } : {}) })))}
          {rows('honors_earned', 'Honors', (row, update) => <>
            {text('Year', row.year_earned, value => update({ year_earned: value }), 'year')}
            <HonorPicker value={catalog.honors.find(honor => honor.id === row.honor_id) ?? null} onChange={honor => {
              if (honor) setCatalog(current => current && ({ ...current, honors: [...current.honors.filter(item => item.id !== honor.id), honor] }))
              update({ honor_id: honor?.id ?? null })
            }} />
          </>, () => ({ honor_id: null, year_earned: PERIODS.at(-1)! }))}
        </fieldset>
      </form>}
  </Modal>
}
