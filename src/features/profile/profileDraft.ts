import type { Json } from '../../lib/database.types'

type Row = Record<string, Json>
type Profile = Record<string, Row[]>

// Compare values independently of object keys, selected-item order, and database identities.
function signature(value: Json): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(signature).sort())
  if (value && typeof value === 'object')
    return JSON.stringify(
      Object.keys(value)
        .filter((key) => !['id', 'pathfinder_id', 'created_at', 'updated_at'].includes(key))
        .sort()
        .map((key) => [key, signature(value[key] ?? null)]),
    )
  return JSON.stringify(value)
}

function entries(profile: Profile, table: string): Row[] {
  if (table === 'pathfinders') return (profile.pathfinders[0].levels ?? []) as Row[]
  return (profile[table] ?? []).flatMap((row) =>
    Array.isArray(row.history) ? (row.history as Row[]) : [row],
  )
}

// Count logical entries rather than IDs: the same detail in another year is allowed.
function duplicateKeys(profile: Profile) {
  const counts = new Map<string, number>()
  const add = (table: string, value: Json) => {
    const key = `${table}:${signature(value)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const table of Object.keys(profile)) {
    if (table === 'current_data') continue
    for (const row of entries(profile, table)) {
      if (table === 'honors_earned' && !row.honor_id) continue
      if ('name' in row && !String(row.name ?? '').trim()) continue
      if (table === 'drill') {
        for (const year of (row.years ?? []) as Json[]) {
          if (year !== null) add(table, { team: row.team, year })
        }
      } else if ((row.year ?? row.year_earned) == null) {
        continue
      } else if (['staff_history', 'drum_corps', 'pbe', 'tlt'].includes(table)) {
        // These editors have one entry per year, with multiple details selected inside it.
        add(table, { year: row.year })
      } else add(table, row)
    }
  }
  return counts
}

export function introducesDuplicate(current: Profile, next: Profile): boolean {
  const before = duplicateKeys(current)
  return [...duplicateKeys(next)].some(
    ([key, count]) => count > 1 && count > (before.get(key) ?? 0),
  )
}

// Only added or changed documentation contributes years. Unchanged legacy history and removals
// must not silently undo an intentional edit to Years Active.
export function withDocumentedYears(original: Profile, draft: Profile): Profile {
  const proposed = structuredClone(draft)
  const years = new Set((proposed.pathfinders[0].years_active ?? []) as string[])
  const add = (year: Json | undefined) => {
    if (typeof year === 'string' && year) years.add(year)
  }
  for (const table of Object.keys(proposed)) {
    const before = new Set(entries(original, table).map(signature))
    for (const row of entries(proposed, table)) {
      if (before.has(signature(row))) continue
      if (table === 'current_data') {
        if (row.status === 'pathfinder' || row.status === 'staff') add(row.school_year)
      } else if (table === 'drill') {
        for (const year of (row.years ?? []) as Json[]) {
          const existed = (original.drill ?? []).some(
            (old) => old.team === row.team && Array.isArray(old.years) && old.years.includes(year),
          )
          if (!existed) add(year)
        }
      } else add(row.year ?? row.year_earned)
    }
  }
  proposed.pathfinders[0].years_active = [...years].sort()
  return proposed
}
