// Application shell: connect to Supabase, manage staff sign-in, and refresh results after saves.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import flcLogo from './assets/FL_Logo.png'
import { getSupabase } from './lib/supabase'
import { message } from './lib/errors'
import Search from './features/search/Search'
import AddRecords from './features/add/AddRecords'

// Show setup instructions if configuration is missing, before mounting components that fetch data.
function App() {
  try {
    getSupabase()
  } catch {
    return (
      <main className="shell">
        <Header />
        <section className="panel">
          <h2>Connect your database</h2>
          <p>
            Set the Supabase URL and publishable key in .env.local, then restart the development
            server. See the README for setup.
          </p>
        </section>
      </main>
    )
  }
  return <ConnectedApp />
}

// The same branding wraps both the sign-in screen and the signed-in action buttons.
function Header({ children }: { children?: ReactNode }) {
  return (
    <header className="brand">
      <img src={flcLogo} alt="Forest Lake Pathfinders" />
      <div className="brand-copy">
        <p className="eyebrow">Forest Lake Pathfinders</p>
        <h1>Member records</h1>
        <p>Explore the years, achievements, and activities of our club.</p>
      </div>
      {children}
    </header>
  )
}

function ConnectedApp() {
  // Increment this counter after additions so Search reloads while keeping its current filters.
  const [recordsVersion, setRecordsVersion] = useState(0)
  // undefined means the session is loading; null means the user is signed out.
  const [session, setSession] = useState<Session | null>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  // Read the existing session and subscribe to later sign-in/sign-out events. Cleanup prevents updates after unmount.
  useEffect(() => {
    let active = true
    const client = getSupabase()
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, next) => {
      if (active) setSession(next)
    })
    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (active) {
          setSession(data.session)
          if (error) setError(message(error))
        }
      })
      .catch((error) => {
        if (active) {
          setError(message(error))
          setSession(null)
        }
      })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])
  // Read browser-validated form fields and let Supabase establish the authenticated session.
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try {
      const { error } = await getSupabase().auth.signInWithPassword({
        email: String(values.get('email')).trim(),
        password: String(values.get('password')),
      })
      if (error) throw error
    } catch (error) {
      setError(message(error))
    } finally {
      setPending(false)
    }
  }
  // Sign out on this browser only; other devices keep their sessions.
  async function signOut() {
    setError('')
    setPending(true)
    try {
      const { error } = await getSupabase().auth.signOut({ scope: 'local' })
      if (error) throw error
      setSession(null)
    } catch (error) {
      setError(message(error))
    } finally {
      setPending(false)
    }
  }
  return (
    <main className="shell">
      <Header>
        {session && (
          <div className="header-actions">
            <div className="session">
              <span>{session.user.email}</span>
              <button className="secondary" disabled={pending} onClick={signOut}>
                Sign out
              </button>
            </div>
            <AddRecords
              key={`add-${session.user.id}`}
              onAdded={() => setRecordsVersion((value) => value + 1)}
            />
          </div>
        )}
      </Header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {session === undefined ? (
        <p role="status">Checking your session…</p>
      ) : session ? (
        <>
          <Search key={session.user.id} recordsVersion={recordsVersion} />
        </>
      ) : (
        <section className="panel login">
          <h2>Staff sign in</h2>
          <p>Use your staff account to search member records.</p>
          <form onSubmit={signIn}>
            <label>
              Email
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <p className="muted">
            Need access or a password reset? Contact your database administrator.
          </p>
        </section>
      )}
    </main>
  )
}

export default App
