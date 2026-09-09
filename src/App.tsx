import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import flcLogo from './assets/FL_Logo.png'
import { getSupabase } from './lib/supabase'
import { ACTIVITIES, EMPTY_FILTERS, EVENTS, LEVELS, PAGE_SIZE, getPathfinder, searchPathfinders,
  type Filters, type Pathfinder, type PathfinderDetails } from './lib/pathfinders'

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
      <Workspace key={session.user.id} />
    </> : <section className="panel login"><h2>Staff sign in</h2><p>Use your approved staff account to search member records.</p>
      <form onSubmit={signIn}><label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button></form>
      <p className="muted">Need access or a password reset? Contact your database administrator.</p>
    </section>}
  </main>
}

function Workspace() {
  const [access, setAccess] = useState<string | null>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    getSupabase().rpc('current_staff_role').then(({ data, error }) => {
      if (active) { if (error) setError(message(error)); else setAccess(data) }
    }, error => { if (active) setError(message(error)) })
    return () => { active = false }
  }, [attempt])
  if (error) return <section className="panel"><p role="alert" className="error">{error}</p><button onClick={() => { setError(''); setAccess(undefined); setAttempt(attempt + 1) }}>Retry connection</button></section>
  if (access === undefined) return <p role="status">Checking staff access…</p>
  if (!access) return <section className="panel"><h2>Staff access required</h2><p>Your account is signed in but has not been approved to view member records. Ask the database administrator to grant access.</p><button onClick={() => { setError(''); setAccess(undefined); setAttempt(attempt + 1) }}>Check access again</button></section>
  return <Search />
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
  function update(key: keyof Filters, value: string) {
    setDraft(current => ({ ...current, [key]: value, ...(key === 'level' && !value ? { advanced: '' } : {}) }))
  }
  function beginSearch() { setBusy(true); setError(''); setMembers([]); setCount(0); setSelected(null) }
  function submit(event: FormEvent) { event.preventDefault(); beginSearch(); setFilters({ ...draft }); setPage(0) }
  function reset() { beginSearch(); setDraft(EMPTY_FILTERS); setFilters({ ...EMPTY_FILTERS }); setPage(0) }
  return <>
    <section className="panel"><h2>Find a Pathfinder</h2><p className="muted">Combine filters to narrow the results. Leave them blank to browse all members.</p>
      <form onSubmit={submit} className="filters">
        <label className="name-filter">Name<input type="search" value={draft.name} onChange={e => update('name', e.target.value)} placeholder="Search by name" maxLength={200} /></label>
        <label>Member ID<input type="number" min="1" max="2147483647" step="1" value={draft.id} onChange={e => update('id', e.target.value)} placeholder="Any ID" /></label>
        <label>Active school year<input value={draft.year} onChange={e => update('year', e.target.value)} placeholder="2024-2025" pattern="[0-9]{4}-[0-9]{4}" title="Use a school year such as 2024-2025" /></label>
        <Select label="Level earned" value={draft.level} options={LEVELS} onChange={value => update('level', value)} />
        <label>Level status<select disabled={!draft.level} value={draft.advanced} onChange={e => update('advanced', e.target.value)}><option value="">Any status</option><option value="true">Advanced</option><option value="false">Regular</option></select></label>
        <Select label="Extracurricular" value={draft.activity} options={ACTIVITIES} onChange={value => update('activity', value)} />
        <Select label="Red Zone event" value={draft.event} options={EVENTS} onChange={value => update('event', value)} />
        <div className="actions"><button type="submit" disabled={busy}>Search records</button><button type="button" className="secondary" onClick={reset}>Clear filters</button></div>
      </form>
    </section>
    <section className="panel" aria-busy={busy}><div className="section-heading"><h2>Members</h2><span role="status">{busy ? 'Searching…' : `${count} ${count === 1 ? 'member' : 'members'} found`}</span></div>
      {error ? <><p role="alert" className="error">{error}</p><button onClick={() => { beginSearch(); setAttempt(attempt + 1) }}>Try again</button></> : !busy && members.length === 0 ?
        <p>No members found. Try fewer filters. If this is a new database, add the first records through Supabase.</p> : members.length > 0 && <>
        <div className="table-scroll"><table><thead><tr><th>Name / ID</th><th>Active years</th><th>Levels earned</th><th>Extracurriculars</th><th>Red Zone</th></tr></thead><tbody>
          {members.map(member => <tr key={member.id}><td><button className="member-link" aria-expanded={selected === member.id} aria-controls="member-details" onClick={() => setSelected(member.id)}>{member.name}</button><small>#{member.id}</small></td>
            <td>{member.years_active.join(', ') || '—'}</td><td>{member.levels.map(l => `${l.advanced ? 'Advanced ' : ''}${l.name}`).join(', ') || '—'}</td>
            <td>{member.extracurriculars.join(', ') || '—'}</td><td>{member.red_zone_participation.join(', ') || '—'}</td></tr>)}
        </tbody></table></div>
        <div className="pagination"><button className="secondary" disabled={page === 0 || busy} onClick={() => { beginSearch(); setPage(page - 1) }}>Previous</button>
          <span>Page {page + 1} of {Math.max(1, Math.ceil(count / PAGE_SIZE))}</span>
          <button className="secondary" disabled={(page + 1) * PAGE_SIZE >= count || busy} onClick={() => { beginSearch(); setPage(page + 1) }}>Next</button></div>
      </>}
    </section>
    {selected !== null && <Details key={selected} id={selected} onClose={() => setSelected(null)} />}
  </>
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={e => onChange(e.target.value)}><option value="">Any</option>{options.map(option => <option key={option}>{option}</option>)}</select></label>
}

function Details({ id, onClose }: { id: number; onClose: () => void }) {
  const [data, setData] = useState<PathfinderDetails>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    getPathfinder(id, controller.signal).then(result => { if (!controller.signal.aborted) setData(result) })
      .catch(error => { if (!controller.signal.aborted) setError(message(error)) })
    return () => controller.abort()
  }, [id, attempt])
  return <section className="panel" id="member-details" aria-label="Member details"><div className="section-heading"><h2>{data?.member.name ?? 'Member details'}</h2><button className="secondary" onClick={onClose}>Close details</button></div>
    {error ? <><p className="error" role="alert">{error}</p><button onClick={() => { setData(undefined); setError(''); setAttempt(attempt + 1) }}>Retry details</button></> : !data ? <p role="status">Loading participation history…</p> : <>
      <p className="muted">Member #{data.member.id} · Active years: {data.member.years_active.join(', ') || 'Not recorded'}</p>
      <h3>Levels earned</h3><p>{data.member.levels.map(l => `${l.advanced ? 'Advanced ' : ''}${l.name}`).join(', ') || 'No levels recorded.'}</p>
      <h3>Extracurricular history</h3>{data.activities.length === 0 && <p>No extracurriculars recorded.</p>}
      <div className="history-grid">{data.activities.map(group => <article key={group.name}><h4>{group.name}</h4>{group.records.length === 0 ? <p>Participation recorded; year details pending.</p> : <ul>{group.records.flatMap((r, index) => r.years.map(year => <li key={`${index}-${year}`}><strong>{year}</strong> — {r.detail}</li>))}</ul>}</article>)}</div>
      <h3>Red Zone history</h3>{data.events.length === 0 && <p>No Red Zone events recorded.</p>}
      <div className="history-grid">{data.events.map(group => <article key={group.name}><h4>{group.name}</h4>{group.records.length === 0 ? <p>Participation recorded; results pending.</p> : <ul>{group.records.map((r, index) => <li key={index}><strong>{r.year}</strong>{r.name ? ` · ${r.name}` : ''} — {r.placement}</li>)}</ul>}</article>)}</div>
      <h3>Honors earned</h3>{data.honors.length ? <ul>{data.honors.map((honor, index) => <li key={index}>{honor.name} — {honor.year}</li>)}</ul> : <p>No honors recorded.</p>}
    </>}
  </section>
}

export default App
