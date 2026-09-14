import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import flcLogo from './assets/FL_Logo.png'
import { getSupabase } from './lib/supabase'
import { ACTIVITY_OPTIONS, EMPTY_FILTERS, EVENT_OPTIONS, LEVEL_OPTIONS, PERIODS, YEARS, STATUSES, PAGE_SIZE, searchPathfinders,
  getPathfinder, saveProfileNotes, LEVELS, type PathfinderDetails, type Filters, type Pathfinder } from './lib/pathfinders'

function message(error: unknown) {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Unable to connect. Please try again.'
}

function App() {
  try { getSupabase() } catch {
    return <main className="shell"><Header /><section className="panel"><h2>Connect your database</h2>
      <p>Set the Supabase URL and publishable key in .env.local, then restart the development server. See the README for setup.</p>
    </section></main>
  }
  return <ConnectedApp />
}

function Header() {
  return <header className="brand"><img src={flcLogo} alt="Forest Lake Pathfinders" />
    <div><p className="eyebrow">Forest Lake Pathfinders</p><h1>Member records</h1>
    <p>Explore the years, achievements, and activities of our club.</p></div></header>
}

function ConnectedApp() {
  const [session, setSession] = useState<Session | null>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => {
    let active = true
    const client = getSupabase()
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
      if (active) setSession(next)
    })
    client.auth.getSession().then(({ data, error }) => {
      if (active) { setSession(data.session); if (error) setError(message(error)) }
    }).catch(error => { if (active) { setError(message(error)); setSession(null) } })
    return () => { active = false; subscription.unsubscribe() }
  }, [])
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setPending(true); setError('')
    try {
      const { error } = await getSupabase().auth.signInWithPassword({
        email: String(values.get('email')).trim(), password: String(values.get('password')),
      })
      if (error) throw error
    } catch (error) { setError(message(error)) } finally { setPending(false) }
  }
  async function signOut() {
    setError(''); setPending(true)
    try {
      const { error } = await getSupabase().auth.signOut({ scope: 'local' })
      if (error) throw error
      setSession(null)
    } catch (error) { setError(message(error)) } finally { setPending(false) }
  }
  return <main className="shell"><Header />
    {error && <p role="alert" className="error">{error}</p>}
    {session === undefined ? <p role="status">Checking your session…</p> : session ? <>
      <div className="session"><span>{session.user.email}</span><button className="secondary" disabled={pending} onClick={signOut}>Sign out</button></div>
      <Search key={session.user.id} />
    </> : <section className="panel login"><h2>Staff sign in</h2><p>Use your staff account to search member records.</p>
      <form onSubmit={signIn}><label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button></form>
      <p className="muted">Need access or a password reset? Contact your database administrator.</p>
    </section>}
  </main>
}

function Search() {
  // Honors are a UI placeholder until the catalog and search integration are added.
  const [honors, setHonors] = useState<string[]>([])
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [members, setMembers] = useState<Pathfinder[]>([])
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    searchPathfinders(filters, page, controller.signal).then(result => {
      if (!controller.signal.aborted) { setMembers(result.members); setCount(result.count) }
    }).catch(error => { if (!controller.signal.aborted) setError(message(error)) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [filters, page, attempt])
  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }
  function beginSearch() { setBusy(true); setError(''); setMembers([]); setCount(0); setSelected(null) }
  function submit(event: FormEvent) { event.preventDefault(); beginSearch(); setFilters({ ...draft }); setPage(0) }
  function reset() { setHonors([]); beginSearch(); setDraft(EMPTY_FILTERS); setFilters({ ...EMPTY_FILTERS }); setPage(0) }
  return <>
    <section className="panel"><h2>Find a Pathfinder</h2><p className="muted">Select one or more options, or type and press Enter to add them. Match any bubble within each category, and every selected category. Years apply to all selected history categories. Leave filters blank to browse all members.</p>
      <form onSubmit={submit} onReset={reset} className="filters">
        <label className="name-filter">Name<input type="search" value={draft.name} onChange={e => update('name', e.target.value)} placeholder="Search by name" maxLength={200} /></label>
        <Select label="Status" value={draft.status} options={STATUSES} onChange={value => update('status', value)} />
        <MultiSelect label="Years" values={draft.year} options={[...PERIODS, ...YEARS]} onChange={value => update('year', value)} />
        <MultiSelect label="Level Earned" values={draft.level} options={LEVEL_OPTIONS} groupKey={option => option.split(' / ')[0].split(' (')[0]} variantLabel={option => option.split(' / ')[1] ?? 'Any'} onChange={value => update('level', value)} />
        <MultiSelect label="Extracurricular" values={draft.activity} options={ACTIVITY_OPTIONS} groupKey={option => option.split(' / ')[0].split(' (')[0]} variantLabel={option => option.split(' / ')[1] ?? 'Any'} onChange={value => update('activity', value)} />
        <MultiSelect label="Red Zone Events" values={draft.event} options={EVENT_OPTIONS} groupKey={option => option.split(' / ')[0].split(' (')[0]} variantLabel={option => option.split(' / ')[1] ?? 'Any'} onChange={value => update('event', value)} />
        <MultiSelect label="Honors" values={honors} options={[]} onChange={setHonors} emptyMessage="No honors available yet" />
        <div className="actions"><button type="submit" disabled={busy}>Search records</button><button type="reset" className="secondary">Clear filters</button></div>
      </form>
    </section>
    <section className="panel" aria-busy={busy}><div className="section-heading"><h2>Members</h2><span role="status">{busy ? 'Searching…' : `${count} ${count === 1 ? 'member' : 'members'} found`}</span></div>
      {error ? <><p role="alert" className="error">{error}</p><button onClick={() => { beginSearch(); setAttempt(attempt + 1) }}>Try again</button></> : !busy && members.length === 0 ?
        <p>No members found. Try fewer filters. If this is a new database, add the first records through Supabase.</p> : members.length > 0 && <>
        <div className="table-scroll"><table><thead><tr><th>First</th><th>Last</th><th>Status</th><th>Title</th><th>Current activities</th></tr></thead><tbody>
          {members.map(member => {
            const inactive = !member.has_current_data || member.status === 'not_active'
            const hasTitle = member.status === 'pathfinder' || member.status === 'staff'
            return <tr key={member.id}>
              <td><button className="member-link" aria-label={`Open profile for ${member.name}`} aria-haspopup="dialog" onClick={() => setSelected(member.id)}>{member.first_name}</button></td>
              <td>{member.last_name || 'Not recorded'}</td><td>{statusLabel(member.status)}</td>
              <td>{hasTitle ? member.current_title ?? 'Not recorded' : 'N/A'}</td>
              <td>{inactive ? 'N/A' : (member.current_activities as string[] | null)?.join(', ') || 'None recorded'}</td></tr>
          })}
        </tbody></table></div>
        <div className="pagination"><button className="secondary" disabled={page === 0 || busy} onClick={() => { beginSearch(); setPage(page - 1) }}>Previous</button>
          <span>Page {page + 1} of {Math.max(1, Math.ceil(count / PAGE_SIZE))}</span>
          <button className="secondary" disabled={(page + 1) * PAGE_SIZE >= count || busy} onClick={() => { beginSearch(); setPage(page + 1) }}>Next</button></div>
      </>}
    </section>
    {selected !== null && <ProfileOverlay key={selected} id={selected} status={members.find(member => member.id === selected)?.status ?? 'not_active'} onClose={() => setSelected(null)} />}
  </>
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={e => onChange(e.target.value)}><option value="">Any</option>{options.map(option => <option key={option}>{option}</option>)}</select></label>
}

function MultiSelect({ compact = false, label, values, options, onChange, exclusiveKey, groupKey, variantLabel, detailOptions, emptyMessage = 'No matching options' }: {
  detailOptions?: Record<string, readonly string[]>; compact?: boolean; label: string; values: string[]; options: readonly string[]; onChange: (values: string[]) => void; exclusiveKey?: (option: string) => string; groupKey?: (option: string) => string; variantLabel?: (option: string) => string; emptyMessage?: string
}) {
  const grouping = groupKey ?? exclusiveKey
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [detailSelections, setDetailSelections] = useState<Record<string, string>>({})
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const matches = options.filter(option => {
    const detail = option.split(' / ')[1] ?? ''
    const group = groupKey?.(option) ?? ''
    const typedDetail = detailOptions && Object.values(detailOptions).flat().some(value => text.toLowerCase().includes(value.toLowerCase()))
    return (!detailOptions || typedDetail || detail === (detailSelections[group] ?? '')) && !values.includes(option) && option.toLowerCase().includes(text.trim().toLowerCase())
  })
  function disabled(option: string) {
    return values.includes(option) || !!exclusiveKey && values.some(value => exclusiveKey(value) === exclusiveKey(option))
  }
  function add(option: string) {
    if (disabled(option)) return
    onChange([...values, option]); setText(''); setActive(0); input.current?.focus()
  }
  useEffect(() => {
    const form = input.current?.form
    const clear = () => { setDetailSelections({}); setText(''); setOpen(false); setActive(0) }
    form?.addEventListener('reset', clear)
    return () => form?.removeEventListener('reset', clear)
  }, [])
  return <div className={compact ? "multi-select compact-options" : "multi-select"} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <label htmlFor={id}>{label}</label>
    <input ref={input} id={id} role="combobox" autoComplete="off" value={text} placeholder="Type or choose?"
      aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list"
      aria-activedescendant={open && matches[active] ? `${id}-option-${active}` : undefined}
      onFocus={() => setOpen(true)} onChange={event => { setText(event.target.value); setActive(0); setOpen(true) }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true)
          setActive(index => Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
        } else if (event.key === 'Enter') {
          event.preventDefault()
          const exact = matches.find(option => option.toLowerCase() === text.trim().toLowerCase())
          if (exact || matches[active]) add(exact ?? matches[active])
          setOpen(true)
        } else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
      }} />
    <div className="selected-options">{values.map(value => <button type="button" className="secondary" key={value}
      aria-label={`Remove ${value} from ${label}`} onClick={() => onChange(values.filter(item => item !== value))}>{value}</button>)}</div>
    {open && <ul id={`${id}-options`} role="listbox" aria-label={`${label} options`} className="option-list">
      {grouping ? [...new Set(matches.map(grouping))].map(level => <li key={level} role="presentation" className={groupKey ? "level-choice activity-year-choice" : "level-choice"}>
        <div role="group" aria-label={level}>
          <span className="level-name">{level}</span>
          {detailOptions?.[level] && <select className="history-detail-select" aria-label={`${level} ${detailKind(level)}`}
            value={detailSelections[level] ?? ''} onChange={event => { setDetailSelections(current => ({ ...current, [level]: event.target.value })); setActive(0) }}>
            <option value="">{`Any ${detailKind(level)}`}</option>
            {detailOptions[level].map(detail => <option key={detail}>{detail}</option>)}
          </select>}
          <div className="level-variants">{matches.filter(option => grouping(option) === level).map(option => {
            const index = matches.indexOf(option)
            return <button type="button" role="option" tabIndex={-1} key={option} id={`${id}-option-${index}`}
              aria-label={option} aria-selected={index === active} aria-disabled={disabled(option)}
              onMouseDown={event => event.preventDefault()} onClick={() => add(option)}>
              {variantLabel ? variantLabel(option) : option.endsWith(' (Any)') ? 'Any' : option.endsWith(' (Advanced)') ? 'Advanced' : 'Basic'}
            </button>
          })}</div>
        </div>
      </li>) : matches.map((option, index) => <li key={option} id={`${id}-option-${index}`} role="option" aria-selected={index === active} aria-disabled={disabled(option)}
        onMouseDown={event => event.preventDefault()} onClick={() => add(option)}>{option}</li>)}
      {!matches.length && <li role="presentation">{emptyMessage}</li>}
    </ul>}
  </div>
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const element = dialog.current!
    const overflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      element.close()
      document.body.style.overflow = overflow
      opener?.focus()
    }
  }, [])
  return <dialog ref={dialog} className="profile-overlay" aria-label={title} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }}>
    <button className="secondary modal-close" onClick={onClose} autoFocus>Close</button>
    {children}
  </dialog>
}

function statusLabel(status: string | null) {
  return status === 'not_active' || !status ? 'Not Active' : status[0].toUpperCase() + status.slice(1)
}
function detailKind(name: string) {
  if (name === 'Drill') return 'team'
  if (name === 'Drums') return 'instrument'
  if (name === 'TLT') return 'operation'
  return (LEVELS as readonly string[]).includes(name) ? 'outcome' : 'placement'
}
function ProfileOverlay({ id, status, onClose }: { id: number; status: string; onClose: () => void }) {
  const [details, setDetails] = useState<PathfinderDetails | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [honorsOpen, setHonorsOpen] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    getPathfinder(id, controller.signal).then(data => {
      if (!controller.signal.aborted) setDetails(data)
    }).catch(error => { if (!controller.signal.aborted) setError(message(error)) })
    return () => controller.abort()
  }, [id, attempt])
  const years = [...new Set(details?.member.years_active ?? [])].sort()
  const levels = [...(details?.member.levels ?? [])].sort((a, b) => LEVELS.indexOf(a.name as typeof LEVELS[number]) - LEVELS.indexOf(b.name as typeof LEVELS[number]) || (a.year ?? '').localeCompare(b.year ?? ''))
  const birthday = details?.member.birth_date
  return <Modal title="Member profile" onClose={onClose}>
    {error ? <><p role="alert" className="error">{error}</p><button onClick={() => { setError(''); setDetails(null); setAttempt(value => value + 1) }}>Try again</button></> : !details ? <p role="status">Loading profile...</p> : <>
      <div className="profile-heading"><h2>{[details.member.first_name, details.member.last_name].filter(Boolean).join(' ')}</h2><span className="profile-status">{statusLabel(status)}</span></div>
      <section className="profile-summary"><h3>Birthday</h3><p>{birthday ? `${birthday.slice(5,7)}/${birthday.slice(8,10)}/${birthday.slice(0,4)}` : 'Not recorded'}</p></section>
      {details.roles.map(group => <section className="profile-role" key={group.role} aria-label={`${group.role === 'staff' ? 'Staff' : 'Pathfinder'} history`}>
        <h3 className="role-heading">{group.role === 'staff' ? 'Staff History' : 'Pathfinder History'}</h3>
        {group.role === 'pathfinder' ? <section className="profile-summary"><h4>Years Active</h4><p>{years.join(', ') || 'No years recorded'}</p>
          <h4>Levels</h4>{levels.length ? <ul>{levels.map((level,index) => <li key={index}>{level.name} ({statusLabel(level.outcome)}) - {level.year ?? 'Year unknown'}</li>)}</ul> : <p>No levels recorded</p>}</section>
        : <section className="profile-summary"><h4>Years and Titles</h4>{details.staffHistory.length ? <dl className="profile-records">{details.staffHistory.map(record => <div key={record.id}><dt>{(record.years as string[]).join(', ')}</dt><dd>{record.title ?? 'Title not recorded'}</dd></div>)}</dl> : <p>No staff years or titles recorded</p>}</section>}
        {group.activities.map(activity => <section className="profile-activity" key={activity.name}>
          <h4>{activity.name === 'Drums' ? 'Drum' : activity.name}</h4>
          <dl className="profile-records">{activity.records.flatMap(record => record.years.map(year => ({ year, detail: record.detail })))
            .sort((a, b) => a.year.localeCompare(b.year) || a.detail.localeCompare(b.detail))
            .map((record, index) => <div key={`${record.year}-${index}`}><dt>{record.year}</dt><dd>{record.detail || 'Details not recorded'}</dd></div>)}</dl>
        </section>)}
        {group.events.length > 0 && <section><h4>Red Zone Events</h4><div className="profile-events">
          {group.events.map(event => <article key={event.name}><h5>{event.name}</h5><ul>{event.records.map((record, index) =>
            <li key={`${record.year}-${index}`}><strong>{record.year}</strong>{record.name && <span>{record.name}</span>}<span>{record.placement}</span></li>)}</ul></article>)}
        </div></section>}
        {group.role === 'pathfinder' && <section className="profile-honors"><h4>Honors</h4><button className="secondary" onClick={() => setHonorsOpen(true)}>View Honors</button></section>}
      </section>)}
      <NotesEditor id={id} initialNotes={details.member.notes ?? ''} />
    </>}
    {honorsOpen && <Modal title="Honors" onClose={() => setHonorsOpen(false)}><h2>Honors</h2><p className="honors-wip">WIP</p></Modal>}
  </Modal>
}
function NotesEditor({ id, initialNotes }: { id: number; initialNotes: string }) {
  const notesId = useId()
  const [notes, setNotes] = useState(initialNotes)
  const [savedNotes, setSavedNotes] = useState(initialNotes)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  async function save(event: FormEvent) {
    event.preventDefault()
    const controller = new AbortController(); request.current = controller
    setPending(true); setError(''); setSaved(false)
    try {
      await saveProfileNotes(id, notes, controller.signal)
      if (!controller.signal.aborted) { setSavedNotes(notes); setSaved(true) }
    } catch(error) { if (!controller.signal.aborted) setError(message(error)) }
    finally { if (!controller.signal.aborted) setPending(false) }
  }
  return <form className="profile-notes" onSubmit={save}><label htmlFor={notesId}>Notes</label><textarea id={notesId} value={notes} rows={5} disabled={pending} onChange={event => { setNotes(event.target.value); setSaved(false) }} placeholder="Add a sentence or several paragraphs" />
    <button disabled={pending || notes === savedNotes}>{pending ? 'Saving...' : 'Save Notes'}</button>
    {notes !== savedNotes && <p className="muted">Unsaved changes - save before closing the profile.</p>}
    {saved && <p role="status">Notes saved</p>}{error && <p role="alert" className="error">{error}</p>}
  </form>
}

export default App
