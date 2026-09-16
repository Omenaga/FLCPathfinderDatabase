// Search the honor catalog and return the selected ID and name to the parent form.

import { useEffect, useId, useState } from 'react'
import { getSupabase } from '../../lib/supabase'
import { message } from '../../lib/errors'

export type Honor = { id: number; name: string }
export default function HonorPicker({
  value,
  onChange,
}: {
  value: Honor | null
  onChange: (value: Honor | null) => void
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Honor[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    // Wait briefly after typing; cancel both the timer and request when the query changes.
    const timer = window.setTimeout(async () => {
      setBusy(true)
      setError('')
      try {
        const { data, error } = await getSupabase()
          .from('honors')
          .select('id,name')
          .ilike('name', `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`)
          .order('name')
          .limit(20)
          .abortSignal(controller.signal)
        if (error) throw error
        if (!controller.signal.aborted) setMatches(data ?? [])
      } catch (error) {
        if (!controller.signal.aborted) setError(message(error))
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, attempt])
  return (
    <div className="honor-picker">
      <label htmlFor={id}>Find an honor</label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setMatches([])
          onChange(null)
        }}
        placeholder="Type an honor name"
      />
      {value && (
        <p role="status">
          Selected: <strong>{value.name}</strong>{' '}
          <button type="button" className="secondary" onClick={() => onChange(null)}>
            Remove honor
          </button>
        </p>
      )}
      {error ? (
        <>
          <p className="error" role="alert">
            {error}
          </p>
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            Retry honors
          </button>
        </>
      ) : busy ? (
        <p role="status">Finding honors…</p>
      ) : (
        <>
          <div className="honor-options">
            {matches.map((honor) => (
              <button
                type="button"
                className="secondary"
                key={honor.id}
                aria-pressed={value?.id === honor.id}
                onClick={() => onChange(honor)}
              >
                {honor.name}
              </button>
            ))}
          </div>
          {!matches.length && <p className="muted">No matching honors in the catalog.</p>}
          {matches.length === 20 && (
            <p className="muted">Showing the first 20 matches. Keep typing to narrow the list.</p>
          )}
        </>
      )}
    </div>
  )
}
