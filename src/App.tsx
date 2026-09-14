import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import flcLogo from './assets/FL_Logo.png'
import { getSupabase } from './lib/supabase'
import { message } from './lib/errors'
import Search from './features/search/Search'
import AddRecords from './features/add/AddRecords'

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
  const [page, setPage] = useState<'search' | 'records'>('search')
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
      <nav className="page-tabs" aria-label="Member pages">
        <button className={page === 'search' ? '' : 'secondary'} aria-current={page === 'search' ? 'page' : undefined} onClick={() => setPage('search')}>Search</button>
        <button className={page === 'records' ? '' : 'secondary'} aria-current={page === 'records' ? 'page' : undefined} onClick={() => setPage('records')}>Add / Edit Profiles</button>
      </nav>
      <div hidden={page !== 'search'}><Search key={session.user.id} /></div>
      {page === 'records' && <AddRecords key={session.user.id} />}
    </> : <section className="panel login"><h2>Staff sign in</h2><p>Use your staff account to search member records.</p>
      <form onSubmit={signIn}><label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button></form>
      <p className="muted">Need access or a password reset? Contact your database administrator.</p>
    </section>}
  </main>
}

export default App
