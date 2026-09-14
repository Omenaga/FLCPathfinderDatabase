import { useEffect, useState, type FormEvent } from 'react'
import Modal from '../../components/Modal'
import MultiSelect from '../../components/MultiSelect'
import { LEVELS, STATUSES } from '../../lib/pathfinders'
import { getSupabase } from '../../lib/supabase'
import { message } from '../../lib/errors'

function staffTitleGroup(title: string) {
  if (title.endsWith(' Counselor')) return 'Counselor'
  if (title.endsWith(' Instructor')) return 'Instructor'
  if (title.endsWith(' Leader')) return 'Leader'
  return 'Other'
}

function staffTitleLabel(title: string) {
  return title.replace(/ (Counselor|Instructor|Leader)$/, '').replace(/^Drum Corps$|^Drum$/, 'Drums')
}

export default function AddRecords() {
  const [open, setOpen] = useState(false)
  return <section className="panel">
    <div className="section-heading"><h2>Add / Edit Profiles</h2><span>Form preview</span></div>
    <p>Create a member profile with their personal details and current registration.</p>
    <button onClick={() => setOpen(true)}>Add Record</button>
    <div className="records-placeholder"><h3>Edit profiles</h3><p className="muted">Profile editing is coming later. You can already update notes from a member’s search profile.</p></div>
    {open && <AddRecordModal onClose={() => setOpen(false)} />}
  </section>
}

function AddRecordModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState('')
  const [titles, setTitles] = useState<string[]>([])
  const [year, setYear] = useState('')
  const [staffTitles, setStaffTitles] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [seconds, setSeconds] = useState(5)
  const [previewed, setPreviewed] = useState(false)
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
  function resetConfirmation() { setDeadline(null); setPreviewed(false) }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading || error) return
    if (deadline !== null && Date.now() < deadline) {
      setDeadline(null); setPreviewed(true)
    } else {
      setPreviewed(false); setSeconds(5); setDeadline(Date.now() + 5000)
    }
  }
  const hasTitle = status === 'Pathfinder' || status === 'Staff'
  const groups = ['Counselor', 'Instructor', 'Leader', 'Other']
  const orderedStaffTitles = [...staffTitles].sort((a, b) =>
    groups.indexOf(staffTitleGroup(a)) - groups.indexOf(staffTitleGroup(b)))
  return <Modal title="Add Record" header={<h2>Add Record</h2>} onClose={onClose}>
    <p className="form-preview">Preview the new registration form. Records are not saved yet.</p>
    {error && <div role="alert"><p className="error">{error}</p><button type="button" className="secondary" onClick={() => { setError(''); setLoading(true); setAttempt(value => value + 1) }}>Retry form options</button></div>}
    <form className="record-form" onSubmit={submit} onChange={resetConfirmation}>
      <div className="record-fields">
        <label>First Name<input name="first_name" required maxLength={200} pattern={'.*\\S.*'} autoComplete="given-name" /></label>
        <label>Last Name<input name="last_name" maxLength={200} autoComplete="family-name" /><small className="muted">Leave blank if unknown.</small></label>
        <label>Status<select required value={status} onChange={event => { setStatus(event.target.value); setTitles([]) }}><option value="">Select status</option>{STATUSES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Birthday<input name="birth_date" type="date" autoComplete="bday" /><small className="muted">Optional if unknown.</small></label>
        <label>Current Year<input readOnly value={year ? `${year.slice(0, 4)}-${Number(year.slice(0, 4)) + 1}` : ''} placeholder={loading ? 'Loading current year…' : 'Unavailable'} /><small className="muted">Current club school year.</small></label>
        <div className={status === 'Staff' ? 'staff-title-select' : undefined}>{hasTitle && !loading && !error ? <MultiSelect key={status} label="Class/Title" values={titles} options={status === 'Pathfinder' ? LEVELS : orderedStaffTitles}
          optionGroup={status === 'Staff' ? staffTitleGroup : undefined} variantLabel={status === 'Staff' ? staffTitleLabel : undefined}
          emptyMessage="No titles available" onChange={values => { setTitles(values); resetConfirmation() }} /> : <label>Class/Title<select disabled><option>{loading ? 'Loading options…' : hasTitle ? 'Options unavailable' : status ? 'N/A' : 'Select a status first'}</option></select></label>}
          {hasTitle && <small className="muted">Choose one or more, or leave blank if unknown.</small>}</div>
      </div>
      <div className="record-footer">
        <p role="status">{previewed ? 'Preview complete. No record was saved.' : deadline !== null ? 'Ready to add this profile? Click Confirm before the timer expires.' : 'Review the details, then click Add to confirm.'}</p>
        <div className="actions"><button type="submit" disabled={loading || !!error}>{deadline !== null ? `Confirm (${seconds}s)` : 'Add'}</button><button type="button" className="secondary" onClick={onClose}>Cancel</button></div>
      </div>
    </form>
  </Modal>
}
