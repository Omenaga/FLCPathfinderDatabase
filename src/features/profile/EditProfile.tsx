import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Modal from '../../components/Modal'
import MultiSelect from '../../components/MultiSelect'
import HonorPicker, { type Honor } from '../add/HonorPicker'
import { getSupabase } from '../../lib/supabase'
import { message } from '../../lib/errors'
import { ACTIVITIES, DRUMS, EVENTS, LEVELS, OPERATIONS, PBE_REGIONS, PERIODS, PLACEMENTS, STATUSES } from '../../lib/pathfinders'
import type { Json } from '../../lib/database.types'

type Row = Record<string, Json>
type Profile = Record<string, Row[]>
type Catalog = { staff: string[]; books: { school_year: string; book_name: string }[]; honors: Honor[] }
const eventTables = ['drill_performance', 'drum_performance', 'honor_evaluations', 'bible_events', 'knots', 'tents', 'jump_rope', 'archery', 'lashing', 'burning_twine']
const strings = (value: Json | undefined) => (Array.isArray(value) ? value : []).map(value => value === null ? 'Unknown' : String(value))

export default function EditProfile({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: () => void }) {
  const notesId = useId()
  const [original, setOriginal] = useState<Profile | null>(null)
  const [draft, setDraft] = useState<Profile | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [seconds, setSeconds] = useState(5)
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
  useEffect(() => {
    if (deadline === null) return
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSeconds(remaining)
      if (!remaining) setDeadline(null)
    }, 100)
    return () => clearInterval(timer)
  }, [deadline])
  function change(table: string, index: number, patch: Row) {
    if (pending) return
    setDraft(current => current && ({ ...current, [table]: current[table].map((row, i) => i === index ? { ...row, ...patch } : row) }))
    setDeadline(null); setError('')
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft || !original || sending.current) return
    if (JSON.stringify(draft) === JSON.stringify(original)) return
    if (draft.honors_earned.some(row => !row.honor_id)) { setError('Select an honor for each earned honor entry.'); return }
    if (deadline === null || Date.now() >= deadline) {
      setSeconds(5); setDeadline(Date.now() + 5000); return
    }
    sending.current = true; setPending(true); setDeadline(null); setError('')
    try {
      const { error } = await getSupabase().rpc('update_profile', { p_id: id, p_original: original, p_profile: draft })
      if (error) throw error
      onSaved()
    } catch (error) { setError(message(error)); setPending(false); sending.current = false }
  }
  function text(label: string, value: Json | undefined, update: (value: Json) => void, kind: 'text' | 'date' | 'year' = 'text', required = false) {
    return <label>{label}<input type={kind === 'date' ? 'date' : 'text'} value={String(value ?? '')} required={required}
      maxLength={kind === 'year' ? 7 : kind === 'text' ? 200 : undefined}
      pattern={kind === 'year' ? '[0-9]{4}-[0-9]{2}' : required && kind === 'text' ? '.*\\S.*' : undefined}
      placeholder={kind === 'year' ? 'YYYY-YY (blank if unknown)' : undefined}
      onChange={e => update(e.target.value || (kind !== 'text' && !required ? null : ''))} /></label>
  }
  function choice(label: string, value: Json | undefined, options: readonly string[], update: (value: Json) => void, optional = false) {
    return <label key={label}>{label}<select value={String(value ?? '')} required={!optional} onChange={e => update(e.target.value || null)}>
      {optional && <option value="">Not recorded</option>}{options.map(option => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}
    </select></label>
  }
  function multiple(label: string, value: Json | undefined, options: readonly string[], update: (value: Json) => void, nullableYears = false) {
    return <MultiSelect label={label} values={strings(value)} options={[...new Set([...options, ...strings(value)])]} onChange={values => update(nullableYears ? values.map(value => value === 'Unknown' ? null : value) : values)} />
  }
  function rows(table: string, label: string, render: (row: Row, update: (patch: Row) => void) => ReactNode) {
    if (!draft?.[table]?.length) return null
    return <section className="edit-section" key={table}><h3>{label}</h3>{draft[table].map((row, index) => <fieldset className="edit-entry" key={String(row.id ?? row.pathfinder_id)}>
      {draft[table].length > 1 && <legend>{label} {index + 1}</legend>}
      <div className="record-fields">{render(row, patch => change(table, index, patch))}</div>
    </fieldset>)}</section>
  }
  function history(table: string, label: string, detailKey: string, detailLabel: string, options: readonly string[]) {
    return rows(table, label, (row, update) => <div className="edit-history">{(row.history as Row[]).map((entry, index) => {
      function set(patch: Row) { update({ history: (row.history as Row[]).map((item, i) => i === index ? { ...item, ...patch } : item) }) }
      return <fieldset className="edit-entry" key={index}><legend>{label} entry {index + 1}</legend><div className="record-fields">
        {text('Year', entry.year, year => set(table === 'pbe' ? { year, books: [] } : { year }), 'year')}
        {multiple(detailLabel, entry[detailKey], table === 'pbe' ? catalog!.books.filter(book => book.school_year === entry.year).map(book => book.book_name) : options, value => set({ [detailKey]: value }))}
        {table === 'pbe' && PBE_REGIONS.map(region => choice(region, (entry.results as Row | undefined)?.[region], PLACEMENTS, value => {
          const results = { ...entry.results as Row }
          if (value) results[region] = value
          else delete results[region]
          set({ results })
        }, true))}
      </div></fieldset>
    })}</div>)
  }
  const changed = draft && original && JSON.stringify(draft) !== JSON.stringify(original)
  return <Modal title="Edit Profile" header={<h2>Edit Profile</h2>} onClose={onClose} closeDisabled={pending}>
    {loadError ? <><p className="error" role="alert">{loadError}</p><button onClick={() => { setLoadError(''); setAttempt(value => value + 1) }}>Retry editor</button></> : !draft || !catalog ? <p role="status">Loading profile editor?</p> :
      <form className="record-form profile-editor" onSubmit={submit}>
        <p>Update existing details below. Use Add to Record for new history. Blank history years mean Unknown.</p>
        <fieldset className="record-fieldset" disabled={pending}>
          {rows('pathfinders', 'Personal details', (row, update) => <>
            {text('First Name', row.first_name, value => update({ first_name: value }), 'text', true)}
            {text('Last Name', row.last_name, value => update({ last_name: value }))}
            {text('Birthday', row.birth_date, value => update({ birth_date: value }), 'date')}
            {multiple('Years Active', row.years_active, PERIODS, value => update({ years_active: value }))}
            <div className="edit-history"><label htmlFor={notesId}>Notes</label><textarea id={notesId} rows={5} value={String(row.notes ?? '')} onChange={e => update({ notes: e.target.value })} placeholder="Add a sentence or several paragraphs" /></div>
            <div className="edit-history"><h4>Levels</h4>{(row.levels as Row[]).map((entry, index) => {
              const set = (patch: Row) => update({ levels: (row.levels as Row[]).map((item, i) => i === index ? { ...item, ...patch } : item) })
              return <fieldset className="edit-entry" key={index}><legend>Level {index + 1}</legend><div className="record-fields">
                {choice('Class', entry.name, LEVELS, value => set({ name: value }))}
                {choice('Outcome', entry.outcome, ['basic', 'advanced', 'incomplete'], value => set({ outcome: value }))}
                {text('Year', entry.year, value => set({ year: value }), 'year')}
              </div></fieldset>
            })}</div>
          </>)}
          {rows('current_data', 'Current registration', (row, update) => <>
            {text('School year', row.school_year, value => update({ school_year: value }), 'year', true)}
            {choice('Status', row.status, STATUSES.map(status => status.toLowerCase().replaceAll(' ', '_')), value => update({ status: value, current_title: null, current_activities: value === 'staff' ? ['N/A'] : [] }))}
            {(row.status === 'staff' || row.status === 'pathfinder') && multiple('Class/Titles', row.current_title, row.status === 'staff' ? catalog.staff : LEVELS, value => update({ current_title: value }))}
            {row.status !== 'staff' && multiple('Current activities', row.current_activities, ACTIVITIES, value => update({ current_activities: value }))}
          </>)}
          {history('staff_history', 'Staff history', 'titles', 'Titles', catalog.staff)}
          {rows('drill', 'Drill', (row, update) => <>
            {choice('Team', row.team, ['Precision', 'Freestyle', 'Adult'], value => update({ team: value }), true)}
            {multiple('Years', row.years, [...PERIODS, 'Unknown'], value => update({ years: value }), true)}
          </>)}
          {history('drum_corps', 'Drums', 'drums', 'Instruments', DRUMS)}
          {history('pbe', 'PBE', 'books', 'Bible books', [])}
          {history('tlt', 'TLT', 'operations', 'Operations', OPERATIONS)}
          {eventTables.map((table, index) => rows(`red_zone_${table}`, EVENTS[index], (row, update) => <>
            {text('Year', row.year, value => update({ year: value }), 'year')}
            {choice('Placement', row.placement, PLACEMENTS, value => update({ placement: value }))}
            {'name' in row && text('Event / evaluation name', row.name, value => update({ name: value }), 'text', true)}
          </>))}
          {rows('honors_earned', 'Honors', (row, update) => <>
            {text('Year', row.year_earned, value => update({ year_earned: value }), 'year')}
            <HonorPicker value={catalog.honors.find(honor => honor.id === row.honor_id) ?? null} onChange={honor => {
              if (honor) setCatalog(current => current && ({ ...current, honors: [...current.honors.filter(item => item.id !== honor.id), honor] }))
              update({ honor_id: honor?.id ?? null })
            }} />
          </>)}
          <div className="record-footer">
            {error && <p className="error" role="alert">{error}</p>}
            <p role="status">{pending ? 'Saving profile?' : deadline !== null ? 'Click Confirm within five seconds to save these changes.' : 'Review your changes, then click Save changes to confirm.'}</p>
            <div className="actions"><button type="submit" disabled={pending || !changed}>{pending ? 'Saving?' : deadline !== null ? `Confirm (${seconds}s)` : 'Save changes'}</button>
              <button type="button" className="secondary" disabled={pending} onClick={onClose}>Cancel</button></div>
          </div>
        </fieldset>
      </form>}
  </Modal>
}
