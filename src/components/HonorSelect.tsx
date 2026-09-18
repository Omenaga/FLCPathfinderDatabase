// The honor-specific data adapter stays separate from the replaceable MultiSelect presentation.
import { useEffect, useState } from 'react'
import MultiSelect from './MultiSelect'
import { getSupabase } from '../lib/supabase'
import { message } from '../lib/errors'

export type Honor = { id: number; name: string; category?: string | null }
const HONOR_CATEGORIES = [
  'Arts & Crafts',
  'Health & Science',
  'Household Arts',
  'Nature',
  'Outdoor Industries',
  'Outreach',
  'Recreation',
  'Vocational',
  'Florida',
  'Master Award',
] as const

export default function HonorSelect({
  label = 'Honors',
  values,
  onChange,
  single = false,
}: {
  label?: string
  values: Honor[]
  onChange: (values: Honor[]) => void
  single?: boolean
}) {
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ query: string; rows: Honor[]; error: string } | null>(null)
  const search = query.trim()
  useEffect(() => {
    if (!search) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const { data, error } = await getSupabase()
          .from('honors')
          .select('id,name,category')
          .ilike('name', `%${search.replace(/[\\%_]/g, '\\$&')}%`)
          .order('name')
          .limit(50)
          .abortSignal(controller.signal)
        if (error) throw error
        if (!controller.signal.aborted) setResult({ query: search, rows: data ?? [], error: '' })
      } catch (error) {
        if (!controller.signal.aborted)
          setResult({ query: search, rows: [], error: message(error) })
      }
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [search, attempt])
  const current = search && result?.query === search ? result : null
  const rank = (category: string | null | undefined) => {
    const index = HONOR_CATEGORIES.indexOf(category as (typeof HONOR_CATEGORIES)[number])
    return index === -1 ? HONOR_CATEGORIES.length : index
  }
  const matches = [...(current?.rows ?? [])].sort(
    (a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name),
  )
  const choices = new Map([...values, ...matches].map((honor) => [honor.name, honor]))
  return (
    <div className="honor-picker">
      <MultiSelect
        className="honor-select"
        label={label}
        single={single}
        closeOnSelect
        values={values.map((honor) => honor.name)}
        options={matches.map((honor) => honor.name)}
        optionGroup={(name) => choices.get(name)?.category ?? 'Uncategorized'}
        variantLabel={(name) => name}
        minQueryLength={1}
        placeholder="Type an honor or award name"
        onSearchChange={(text) => {
          setQuery(text)
          if (text.trim() !== search) setResult(null)
        }}
        onChange={(names) => onChange(names.map((name) => choices.get(name)!))}
        emptyMessage={
          current?.error
            ? 'Could not load honors.'
            : current
              ? 'No matching honors.'
              : 'Finding honors…'
        }
      />
      {current?.error && (
        <>
          <p className="error" role="alert">
            {current.error}
          </p>
          <button
            type="button"
            onClick={() => {
              setResult(null)
              setAttempt((n) => n + 1)
            }}
          >
            Retry honors
          </button>
        </>
      )}
      {current?.rows.length === 50 && (
        <p className="muted">Showing the first 50 matches. Keep typing to narrow the list.</p>
      )}
    </div>
  )
}
