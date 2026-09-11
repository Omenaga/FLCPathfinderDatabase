import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import flcLogo from './assets/FL_Logo.png'
import { getSupabase } from './lib/supabase'
import { ACTIVITIES, EMPTY_FILTERS, EVENTS, LEVELS, YEARS, STATUSES, PAGE_SIZE, searchPathfinders,
  type Filters, type Pathfinder } from './lib/pathfinders'

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
    setDraft(current => ({ ...current, [key]: value, ...(key === 'level' && Array.isArray(value) && !value.length ? { advanced: '' } : {}) }))
  }
  function beginSearch() { setBusy(true); setError(''); setMembers([]); setCount(0); setSelected(null) }
  function submit(event: FormEvent) { event.preventDefault(); beginSearch(); setFilters({ ...draft }); setPage(0) }
  function reset() { beginSearch(); setDraft(EMPTY_FILTERS); setFilters({ ...EMPTY_FILTERS }); setPage(0) }
  return <>
    <section className="panel"><h2>Find a Pathfinder</h2><p className="muted">Select one or more options, or type and press Enter to add them. Members must match every selection. Leave filters blank to browse all members.</p>
      <form onSubmit={submit} onReset={reset} className="filters">
        <label className="name-filter">Name<input type="search" value={draft.name} onChange={e => update('name', e.target.value)} placeholder="Search by name" maxLength={200} /></label>
        <MultiSelect label="Active year" values={draft.year} options={YEARS} onChange={value => update('year', value)} />
        <Select label="Status" value={draft.status} options={STATUSES} onChange={value => update('status', value)} />
        <MultiSelect label="Level earned" values={draft.level} options={LEVELS} onChange={value => update('level', value)} />
        <label>Level status<select disabled={!draft.level.length} value={draft.advanced} onChange={e => update('advanced', e.target.value)}><option value="">Any status</option><option value="true">Advanced</option><option value="false">Regular</option></select></label>
        <MultiSelect label="Extracurricular" values={draft.activity} options={ACTIVITIES} onChange={value => update('activity', value)} />
        <MultiSelect label="Red Zone event" values={draft.event} options={EVENTS} onChange={value => update('event', value)} />
        <div className="actions"><button type="submit" disabled={busy}>Search records</button><button type="reset" className="secondary">Clear filters</button></div>
      </form>
    </section>
    <section className="panel" aria-busy={busy}><div className="section-heading"><h2>Members</h2><span role="status">{busy ? 'Searching…' : `${count} ${count === 1 ? 'member' : 'members'} found`}</span></div>
      {error ? <><p role="alert" className="error">{error}</p><button onClick={() => { beginSearch(); setAttempt(attempt + 1) }}>Try again</button></> : !busy && members.length === 0 ?
        <p>No members found. Try fewer filters. If this is a new database, add the first records through Supabase.</p> : members.length > 0 && <>
        <div className="table-scroll"><table><thead><tr><th>Name</th><th>Status</th><th>Grade</th><th>Current class</th><th>Current activities</th></tr></thead><tbody>
          {members.map(member => {
            const departed = !member.has_current_data || member.status === 'graduated'
            const status = member.status ? member.status[0].toUpperCase() + member.status.slice(1) : 'Not recorded'
            return <tr key={member.id}><td><button className="member-link" aria-haspopup="dialog" onClick={() => setSelected(member.id)}>{member.name}</button></td>
              <td>{member.status === 'graduated' ? 'Graduated' : member.has_current_data ? status : 'Unregistered'}</td>
              <td>{departed ? 'N/A' : member.grade ?? '?'}</td>
              <td>{departed ? 'N/A' : member.class_level ?? '?'}</td>
              <td>{departed ? 'N/A' : (member.current_activities as string[] | null)?.join(', ') || '?'}</td></tr>
          })}
        </tbody></table></div>
        <div className="pagination"><button className="secondary" disabled={page === 0 || busy} onClick={() => { beginSearch(); setPage(page - 1) }}>Previous</button>
          <span>Page {page + 1} of {Math.max(1, Math.ceil(count / PAGE_SIZE))}</span>
          <button className="secondary" disabled={(page + 1) * PAGE_SIZE >= count || busy} onClick={() => { beginSearch(); setPage(page + 1) }}>Next</button></div>
      </>}
    </section>
    {selected !== null && <ProfileOverlay onClose={() => setSelected(null)} />}
  </>
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={e => onChange(e.target.value)}><option value="">Any</option>{options.map(option => <option key={option}>{option}</option>)}</select></label>
}

function MultiSelect({ label, values, options, onChange }: {
  label: string; values: string[]; options: readonly string[]; onChange: (values: string[]) => void
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const matches = options.filter(option => !values.includes(option) && option.toLowerCase().includes(text.trim().toLowerCase()))
  function add(option: string) {
    onChange([...values, option]); setText(''); setActive(0); input.current?.focus()
  }
  useEffect(() => {
    const form = input.current?.form
    const clear = () => { setText(''); setOpen(false); setActive(0) }
    form?.addEventListener('reset', clear)
    return () => form?.removeEventListener('reset', clear)
  }, [])
  return <div className="multi-select" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <label htmlFor={id}>{label}</label>
    <div className="selected-options">{values.map(value => <button type="button" className="secondary" key={value}
      aria-label={`Remove ${value} from ${label}`} onClick={() => onChange(values.filter(item => item !== value))}>{value} ?</button>)}</div>
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
    {open && <ul id={`${id}-options`} role="listbox" aria-label={`${label} options`} className="option-list">
      {matches.map((option, index) => <li key={option} id={`${id}-option-${index}`} role="option" aria-selected={index === active}
        onMouseDown={event => event.preventDefault()} onClick={() => add(option)}>{option}</li>)}
      {!matches.length && <li role="presentation">No matching options</li>}
    </ul>}
    {label === 'Level earned' && <small>Level status applies to every selected level.</small>}
  </div>
}

function ProfileOverlay({ onClose }: { onClose: () => void }) {
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
  return <dialog ref={dialog} className="profile-overlay" aria-label="Member profile" onCancel={event => { event.preventDefault(); onClose() }}>
    <button className="secondary" onClick={onClose} autoFocus>Close</button>
    <p>WIP</p>
  </dialog>
}

export default App
