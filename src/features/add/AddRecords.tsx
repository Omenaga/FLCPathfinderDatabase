import { useEffect, useRef, useState, type FormEvent } from 'react'
import Modal from '../../components/Modal'
import MultiSelect from '../../components/MultiSelect'
import { LEVELS, STATUSES } from '../../lib/pathfinders'
import { getSupabase } from '../../lib/supabase'
import { message } from '../../lib/errors'
import AddToRecord from './AddToRecord'

function staffTitleGroup(title: string) {
  if (title.endsWith(' Counselor')) return 'Counselor'
  if (title.endsWith(' Instructor')) return 'Instructor'
  if (title.endsWith(' Leader')) return 'Leader'
  return 'Other'
}

function staffTitleLabel(title: string) {
  return title.replace(/ (Counselor|Instructor|Leader)$/, '').replace(/^Drum Corps$|^Drum$/, 'Drums')
}

export default function AddRecords({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  return <section className="panel">
    <div className="section-heading"><h2>Add</h2></div>
    <p>Create a member profile with their personal details and current registration.</p>
    <button onClick={() => setOpen(true)}>Add New Profile</button>
    <div className="records-placeholder"><h3>Add to Record</h3><p className="muted">Add achievements and participation to one or more existing profiles.</p><button onClick={() => setHistoryOpen(true)}>Add to Record</button></div>
    {open && <AddRecordModal onClose={() => setOpen(false)} onAdded={onAdded} />}
    {historyOpen && <AddToRecord onClose={() => setHistoryOpen(false)} onAdded={onAdded} />}
  </section>
}

function AddRecordModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [status, setStatus] = useState('')
  const [titles, setTitles] = useState<string[]>([])
  const [year, setYear] = useState('')
  const [staffTitles, setStaffTitles] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [seconds, setSeconds] = useState(5)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [personal, setPersonal] = useState({ firstName: '', lastName: '', birthday: '' })
  const [requestId] = useState(() => crypto.randomUUID())
  const submitting = useRef(false)
  const [summary, setSummary] = useState<{ firstName: string; lastName: string; birthday: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const [season, catalog] = await Promise.all([
          getSupabase().rpc('current_club_year').abortSignal(controller.signal),
          getSupabase().from('staff_titles').select('title').order('title').abortSignal(controller.signal),
        ])
        if (season.error) throw season.error
        if (catalog.error) throw catalog.error
        if (!controller.signal.aborted) {
          setYear(season.data)
          setStaffTitles(catalog.data.map(row => row.title))
        }
      } catch (error) { if (!controller.signal.aborted) setError(message(error)) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [attempt])
  useEffect(() => {
    if (deadline === null) return
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSeconds(remaining)
      if (!remaining) setDeadline(null)
    }, 100)
    return () => window.clearInterval(timer)
  }, [deadline])
  function resetConfirmation() { setDeadline(null); setSaveError('') }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading || error || submitting.current) return
    if (deadline !== null && Date.now() < deadline) {
      const fields = new FormData(event.currentTarget)
      const details = { firstName: String(fields.get('first_name') ?? '').trim(), lastName: String(fields.get('last_name') ?? '').trim(), birthday: String(fields.get('birth_date') ?? '') }
      setDeadline(null); setSaveError(''); setSaving(true); submitting.current = true
      try {
        const { data, error } = await getSupabase().rpc('add_member_record', {
          p_request_id: requestId,
          p_first_name: details.firstName,
          p_last_name: details.lastName,
          p_birth_date: details.birthday || null,
          p_status: status.toLowerCase().replaceAll(' ', '_'),
          p_current_title: (status === 'Pathfinder' || status === 'Staff') && titles.length ? titles : null,
          p_school_year: year,
        })
        if (error) throw error
        if (!Number.isInteger(data)) throw new Error('Could not confirm the save. Retry with the same details.')
        setSummary(details); setSaved(true); onAdded()
      } catch (error) { setSaveError(message(error)) }
      finally { setSaving(false); submitting.current = false }
    } else {
      setSaveError(''); setSeconds(5); setDeadline(Date.now() + 5000)
    }
  }
  const hasTitle = status === 'Pathfinder' || status === 'Staff'
  const groups = ['Counselor', 'Instructor', 'Leader', 'Other']
  const orderedStaffTitles = [...staffTitles].sort((a, b) =>
    groups.indexOf(staffTitleGroup(a)) - groups.indexOf(staffTitleGroup(b)))
  const displayYear = year ? `${year.slice(0, 4)}-${Number(year.slice(0, 4)) + 1}` : 'Not recorded'
  if (saving) return <Modal title="Adding Record" header={<h2>Adding Record</h2>} onClose={onClose} closeDisabled>
    <div className="record-feedback" role="status" aria-live="polite" aria-busy="true">
      <p>Saving the new profile…</p><p className="muted">Please wait while the record is submitted.</p>
    </div>
  </Modal>
  if (saveError) return <Modal title="Unable to Add Record" header={<h2>Unable to Add Record</h2>} onClose={onClose}>
    <p className="error" role="alert">{saveError}</p>
    <p>Your entered details have been kept. Return to the form to review them or try again.</p>
    <button onClick={() => setSaveError('')}>Back to form</button>
  </Modal>
  if (saved && summary) return <Modal title="Record Added" header={<h2>Record Added</h2>} onClose={onClose}>
    <p role="status">The new profile has been saved.</p>
    <section className="profile-summary" aria-label="New profile summary">
      <h3>{[summary.firstName, summary.lastName].filter(Boolean).join(' ')}</h3>
      <dl className="profile-records">
        <div><dt>First Name</dt><dd>{summary.firstName}</dd></div>
        <div><dt>Last Name</dt><dd>{summary.lastName || 'Not recorded'}</dd></div>
        <div><dt>Status</dt><dd>{status}</dd></div>
        <div><dt>Birthday</dt><dd>{summary.birthday ? `${summary.birthday.slice(5, 7)}/${summary.birthday.slice(8, 10)}/${summary.birthday.slice(0, 4)}` : 'Not recorded'}</dd></div>
        <div><dt>Class/Title</dt><dd>{hasTitle ? titles.join(', ') || 'Not recorded' : 'N/A'}</dd></div>
        <div><dt>Current Year</dt><dd>{displayYear}</dd></div>
      </dl>
    </section>
  </Modal>
  return <Modal title="Add New Profile" header={<h2>Add New Profile</h2>} onClose={onClose} closeDisabled={saving}>
    <p>Enter the member’s details and current registration.</p>
    {error && <div role="alert"><p className="error">{error}</p><button type="button" className="secondary" onClick={() => { setError(''); setLoading(true); setAttempt(value => value + 1) }}>Retry form options</button></div>}
    <form className="record-form" onSubmit={submit} onChange={resetConfirmation} aria-busy={saving}>
      <fieldset disabled={saving} className="record-fieldset">
      <div className="record-fields">
        <label>First Name<input name="first_name" value={personal.firstName} onChange={e => setPersonal({...personal, firstName:e.target.value})} required maxLength={200} pattern={'.*\\S.*'} autoComplete="given-name" /></label>
        <label>Last Name<input name="last_name" value={personal.lastName} onChange={e => setPersonal({...personal, lastName:e.target.value})} maxLength={200} autoComplete="family-name" /><small className="muted">Leave blank if unknown.</small></label>
        <label>Status<select required value={status} onChange={event => { setStatus(event.target.value); setTitles([]) }}><option value="">Select status</option>{STATUSES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Birthday<input name="birth_date" value={personal.birthday} onChange={e => setPersonal({...personal, birthday:e.target.value})} type="date" autoComplete="bday" /><small className="muted">Optional if unknown.</small></label>
        <label>Current Year<input readOnly value={year ? `${year.slice(0, 4)}-${Number(year.slice(0, 4)) + 1}` : ''} placeholder={loading ? 'Loading current year…' : 'Unavailable'} /><small className="muted">Current club school year.</small></label>
        <div className={status === 'Staff' ? 'staff-title-select' : undefined}>{status === 'Pathfinder' ? <label>Class/Title<select value={titles[0] ?? ''} onChange={e => setTitles(e.target.value ? [e.target.value] : [])}><option value="">Not recorded</option>{LEVELS.map(level => <option key={level}>{level}</option>)}</select></label> : hasTitle && !loading && !error ? <MultiSelect key={status} label="Class/Title" values={titles} options={orderedStaffTitles}
          optionGroup={status === 'Staff' ? staffTitleGroup : undefined} variantLabel={status === 'Staff' ? staffTitleLabel : undefined}
          emptyMessage="No titles available" onChange={values => { if (!submitting.current) { setTitles(values); resetConfirmation() } }} /> : <label>Class/Title<select disabled><option>{loading ? 'Loading options…' : hasTitle ? 'Options unavailable' : status ? 'N/A' : 'Select a status first'}</option></select></label>}
          {hasTitle && <small className="muted">{status === 'Pathfinder' ? 'Choose one class, or leave blank if unknown.' : 'Choose one or more, or leave blank if unknown.'}</small>}</div>
      </div>
      {/* Keep the inline choices from collapsing between pointer down and click. */}
      <div className="record-footer" onMouseDown={event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault() }}>
        <p role="status">{saving ? 'Saving record…' : deadline !== null ? 'Ready to add this profile? Click Confirm before the timer expires.' : 'Review the details, then click Add to confirm.'}</p>
        {saveError && <p role="alert" className="error">{saveError}</p>}
        <div className="actions"><button type="submit" disabled={loading || !!error || saving}>{saving ? 'Saving…' : deadline !== null ? `Confirm (${seconds}s)` : 'Add'}</button><button type="button" className="secondary" onClick={onClose} disabled={saving}>Cancel</button></div>
      </div>
      </fieldset>
    </form>
  </Modal>
}
