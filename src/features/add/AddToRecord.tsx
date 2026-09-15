import { useEffect, useRef, useState, type FormEvent } from 'react'
import Modal from '../../components/Modal'
import MultiSelect from '../../components/MultiSelect'
import Search from '../search/Search'
import HonorPicker, { type Honor } from './HonorPicker'
import { getSupabase } from '../../lib/supabase'
import { message } from '../../lib/errors'
import { LEVELS, DRUMS, OPERATIONS, EVENTS, PLACEMENTS, period, type Pathfinder } from '../../lib/pathfinders'
import { statusLabel } from '../../lib/format'
import type { Json } from '../../lib/database.types'

type Kind = 'level' | 'staff' | 'drill' | 'drums' | 'pbe' | 'tlt' | 'event' | 'honor'
type Receipt = { id: number; name: string; status: 'added' | 'already' | 'error'; reason?: string; year_added: boolean }
const kinds: { value: Kind; label: string }[] = [
  { value: 'level', label: 'Level Earned — Pathfinder' }, { value: 'staff', label: 'Level Earned — Staff Title' },
  { value: 'drill', label: 'Extracurricular — Drill' }, { value: 'drums', label: 'Extracurricular — Drum' },
  { value: 'pbe', label: 'Extracurricular — PBE' }, { value: 'tlt', label: 'Extracurricular — TLT' },
  { value: 'event', label: 'Red Zone Events' }, { value: 'honor', label: 'Honors' },
]

export default function AddToRecord({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [step, setStep] = useState<'details' | 'people' | 'review' | 'saving' | 'result' | 'error'>('details')
  const [year, setYear] = useState('')
  const [kind, setKind] = useState<Kind>('level')
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear())
  const [name, setName] = useState('')
  const [outcome, setOutcome] = useState('basic')
  const [details, setDetails] = useState<string[]>([])
  const [event, setEvent] = useState<string>(EVENTS[0])
  const [placement, setPlacement] = useState<string>(PLACEMENTS[0])
  const [honor, setHonor] = useState<Honor | null>(null)
  const [catalog, setCatalog] = useState<{ staff: string[]; books: { school_year: string; book_name: string }[] } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Pathfinder[]>([])
  const [results, setResults] = useState<Receipt[]>([])
  const sending = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const [staff, books, season] = await Promise.all([
          getSupabase().from('staff_titles').select('title').order('sort_order').abortSignal(controller.signal),
          getSupabase().from('pbe_year_books').select('school_year,book_name').order('school_year').abortSignal(controller.signal),
          getSupabase().rpc('current_club_year').abortSignal(controller.signal),
        ])
        if (staff.error) throw staff.error
        if (books.error) throw books.error
        if (season.error) throw season.error
        if (!controller.signal.aborted) { setCatalog({ staff: staff.data.map(row => row.title), books: books.data }); setYear(current => current || season.data); setCurrentYear(Number(season.data.slice(0,4))); setLoadError('') }
      } catch (error) { if (!controller.signal.aborted) setLoadError(message(error)) }
    }
    void load()
    return () => controller.abort()
  }, [attempt])
  const eligible = selected.filter(person => !(kind === 'staff' && person.status === 'pathfinder'))
  const selectedDetails = kind === 'pbe' ? catalog?.books.filter(book => book.school_year === year).map(book => book.book_name) ?? [] : details
  const namedEvent = event === 'Honor Evaluations' || event === 'Bible Events'
  const entry: Json = kind === 'level' ? { kind, name, outcome } : kind === 'staff' ? { kind, details: [name] }
    : kind === 'drill' ? { kind, team: name } : kind === 'event' ? { kind, event, placement, ...(namedEvent ? { name: name.trim() } : {}) }
    : kind === 'honor' ? { kind, honor_id: honor?.id ?? null } : { kind, details: selectedDetails }
  const description = kind === 'level' ? `${name} (${statusLabel(outcome)})` : kind === 'staff' || kind === 'drill' ? name
    : kind === 'event' ? `${event}${namedEvent ? ` — ${name}` : ''}: ${placement}` : kind === 'honor' ? honor?.name : selectedDetails.join(', ')
  function next(formEvent: FormEvent) {
    formEvent.preventDefault()
    if (!catalog || !year || ['level','staff','drill'].includes(kind) && !name || kind === 'level' && !outcome || kind === 'event' && (!event || !placement || namedEvent && !name.trim()) || kind === 'honor' && !honor || ['drums','pbe','tlt'].includes(kind) && !selectedDetails.length) { setError(kind === 'pbe' && !selectedDetails.length ? 'No Bible books are configured for this year.' : 'Choose the information to add.'); return }
    setSelected(eligible); setError(''); setStep('people')
  }
  function toggle(person: Pathfinder) { setSelected(current => current.some(row => row.id === person.id) ? current.filter(row => row.id !== person.id) : [...current, person]) }
  async function save() {
    if (sending.current || !eligible.length) return
    sending.current = true; setError(''); setStep('saving')
    try {
      const { data, error } = await getSupabase().rpc('add_to_records', { p_ids: eligible.map(row => row.id!), p_year: year, p_entry: entry })
      if (error) throw error
      if (!Array.isArray(data)) throw new Error('Could not confirm the result. Retry to check which profiles already have this information.')
      setResults(data as unknown as Receipt[]); setStep('result'); onAdded()
    } catch (error) { setError(message(error)); setStep('error') }
    finally { sending.current = false }
  }
  function summary() { return <section className="history-receipt"><h3>{step === 'result' ? 'Documentation receipt' : 'Information to add'}</h3><dl className="profile-records">
    <div><dt>Year</dt><dd>{year}</dd></div>
    <div><dt>Category</dt><dd>{kinds.find(item => item.value === kind)?.label}</dd></div><div><dt>Details</dt><dd>{description}</dd></div>
  </dl></section> }
  const title = step === 'saving' ? 'Adding to Records' : step === 'result' ? (results.some(row => row.status === 'error') ? 'Completed with Errors' : results.every(row => row.status === 'already' && !row.year_added) ? 'Information Already Recorded' : 'Records Updated') : step === 'error' ? 'Unable to Add Information' : step === 'review' ? 'Confirm Additions' : 'Add to Record'
  return <Modal title={title} header={<h2>{title}</h2>} onClose={onClose} closeDisabled={step === 'saving'} wide={step === 'people'}>
    {step === 'saving' ? <p role="status">Saving information to the selected profiles…</p> : step === 'error' ? <>
      <p className="error" role="alert">{error}</p><p>Your information and selected profiles have been kept. A retry checks for existing information before adding anything.</p><button onClick={() => setStep('review')}>Back to confirmation</button>
    </> : step === 'result' ? <>
      {summary()}
      {(['added','already','error'] as const).filter(status => results.some(row => row.status === status)).map(status => <section key={status}><h3>{status === 'added' ? 'Added' : status === 'already' ? 'Already had this information' : 'Not added'} ({results.filter(row => row.status === status).length})</h3>
        <ul>{results.filter(row => row.status === status).map(row => <li key={row.id}><strong>{row.name}</strong>{row.reason && <p className="error">{row.reason}</p>}{row.year_added && status === 'already' && <span> — Years Active updated</span>}</li>)}</ul></section>)}
      {results.some(row => row.status === 'error') && <button className="secondary" onClick={() => { setSelected(eligible.filter(person => results.some(row => row.id === person.id && row.status === 'error'))); setStep('details') }}>Review failed profiles</button>}
    </> : step === 'review' ? <>
      {summary()}<h3>Profiles receiving this information ({eligible.length})</h3>
      <ul>{eligible.map(person => <li key={person.id}>{person.name} — {statusLabel(person.status)}</li>)}</ul>
      <p className="muted">Existing information will be skipped. The final receipt will show additions, existing information, and any errors.</p>
      <div className="actions"><button onClick={() => void save()}>Confirm</button><button className="secondary" onClick={() => setStep('people')}>Back to profiles</button></div>
    </> : step === 'people' ? <>
      {summary()}<p>Select profiles across searches and pages. {kind === 'staff' && 'Current Pathfinders cannot receive a Staff title.'}</p>
      <Search selection={{ members: eligible, onToggle: toggle, excludePathfinders: kind === 'staff' }} />
      <section className="selected-profiles" aria-label="Selected profiles"><h3>Selected profiles ({eligible.length})</h3>
        {eligible.length ? <ul className="selected-profile-list">{eligible.map(person => <li key={person.id}><label><input type="checkbox" checked aria-label={`Deselect ${person.name}`} onChange={() => toggle(person)} />{person.name} — {statusLabel(person.status)}</label></li>)}</ul> : <p>No profiles selected yet.</p>}
      </section>
      <div className="actions"><button disabled={!eligible.length} onClick={() => setStep('review')}>Finish / Done</button><button className="secondary" onClick={() => { setSelected([]); setStep('details') }}>Back to information</button></div>
    </> : <>
      <p>Choose a year and one kind of information, then select the profiles that should receive it.</p>
      {loadError && <><p className="error" role="alert">{loadError}</p><button onClick={() => { setLoadError(''); setAttempt(v => v + 1) }}>Retry options</button></>}
      {!catalog && !loadError && <p role="status">Loading options…</p>}
      <form onSubmit={next} className="record-form"><div className="record-fields">
        <label>Information category<select value={kind} onChange={e => { setKind(e.target.value as Kind); setName(''); setDetails([]); setHonor(null); setError('') }}>{kinds.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <MultiSelect single label="Year to document" values={year ? [year] : []} options={Array.from({length: Math.max(0,currentYear - 2009)},(_,index) => period(currentYear-index))} onChange={values => setYear(values[0] ?? '')} />
        {(kind === 'level' || kind === 'staff' || kind === 'drill') && <MultiSelect single key={kind} label={kind === 'level' ? 'Class' : kind === 'staff' ? 'Staff title' : 'Drill team'} values={name ? [name] : []} onChange={values => setName(values[0] ?? '')} options={kind === 'level' ? LEVELS : kind === 'staff' ? catalog?.staff ?? [] : ['Precision','Freestyle','Adult']} />}
        {kind === 'level' && <MultiSelect single label="Outcome" values={outcome ? [statusLabel(outcome)] : []} options={['Basic','Advanced','Incomplete']} onChange={values => setOutcome(values[0]?.toLowerCase() ?? '')} />}
        {['drums','tlt'].includes(kind) && <MultiSelect key={kind} label={kind === 'drums' ? 'Instruments' : 'Operations'} values={details} onChange={setDetails} options={kind === 'drums' ? DRUMS : OPERATIONS} />}
        {kind === 'pbe' && <section className="pbe-summary" aria-label="Bible books"><h3>Bible books</h3>{selectedDetails.length ? <p><span className="muted">All books for {year} will be added: </span>{selectedDetails.join(', ')}.</p> : <p className="muted">No Bible books are configured for this year.</p>}</section>}
        {kind === 'event' && <><MultiSelect single label="Event" values={event ? [event] : []} options={EVENTS} onChange={values => { setEvent(values[0] ?? ''); setName('') }} /><MultiSelect single label="Placement" values={placement ? [placement] : []} options={PLACEMENTS} onChange={values => setPlacement(values[0] ?? '')} />{namedEvent && <label>Event / evaluation name<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>}</>}
      </div>
      {kind === 'honor' && <HonorPicker value={honor} onChange={setHonor} />}
      {selected.length !== eligible.length && <p className="muted">{selected.length - eligible.length} current Pathfinder selection(s) will be removed for this Staff title.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="record-footer" onMouseDown={e => { if ((e.target as HTMLElement).closest('button')) e.preventDefault() }}><button disabled={!catalog || !!loadError}>Select profiles</button></div>
      </form>
    </>}
  </Modal>
}
