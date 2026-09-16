// Turn two database snapshots into a human-readable receipt, hiding internal IDs and unchanged values.

import type { Json } from '../../lib/database.types'
import { statusLabel } from '../../lib/format'

type Row = Record<string, Json>
type Profile = Record<string, Row[]>
type Item = { key: string; label: string; text: string }
export type ProfileChange = {
  kind: 'Added' | 'Updated' | 'Removed'
  label: string
  before?: string
  after?: string
}
const labels: Record<string, string> = {
  first_name: 'First Name',
  last_name: 'Last Name',
  birth_date: 'Birthday',
  notes: 'Notes',
  years_active: 'Years Active',
  school_year: 'School Year',
  status: 'Status',
  current_title: 'Class/Titles',
  current_activities: 'Current Activities',
  year: 'Year',
  year_earned: 'Year',
  outcome: 'Outcome',
  titles: 'Titles',
  drums: 'Instruments',
  books: 'Bible Books',
  operations: 'Operations',
  results: 'Results',
  team: 'Team',
  years: 'Years',
  placement: 'Placement',
  name: 'Name',
  honor_id: 'Honor',
}
const tables: Record<string, string> = {
  staff_history: 'Staff History',
  drum_corps: 'Drums',
  pbe: 'PBE',
  tlt: 'TLT',
  drill: 'Drill',
  honors_earned: 'Honors',
  red_zone_drill_performance: 'Drill Performance',
  red_zone_drum_performance: 'Drum Performance',
  red_zone_honor_evaluations: 'Honor Evaluations',
  red_zone_bible_events: 'Bible Events',
  red_zone_knots: 'Knots Relay',
  red_zone_tents: 'Tents',
  red_zone_jump_rope: 'Jump Rope',
  red_zone_archery: 'Archery',
  red_zone_lashing: 'Lashing',
  red_zone_burning_twine: 'Burning Twine',
}
export function profileChanges(
  original: Profile,
  proposed: Profile,
  honors: { id: number; name: string }[],
): ProfileChange[] {
  function display(value: Json | undefined, key: string): string {
    if (value === null || value === undefined || value === '')
      return ['year', 'year_earned'].includes(key) ? 'Unknown' : 'Not Recorded'
    if (Array.isArray(value))
      return value.length
        ? value
            .map((item) => display(item, key))
            .sort()
            .join(', ')
        : 'None'
    if (typeof value === 'object')
      return (
        Object.entries(value)
          .map(([field, item]) => `${labels[field] ?? field}: ${display(item, field)}`)
          .join('; ') || 'None'
      )
    if (key === 'honor_id')
      return honors.find((honor) => honor.id === value)?.name ?? 'Unlisted Honor'
    if (key === 'status' || key === 'outcome') return statusLabel(String(value))
    return String(value)
  }
  function describe(row: Row, omitBooks = false) {
    return Object.entries(row)
      .filter(([key]) => key in labels && !(omitBooks && key === 'books'))
      .map(([key, value]) => `${labels[key]}: ${display(value, key)}`)
      .join('; ')
  }
  // Assign comparison keys to visible fields and history instances across different table shapes.
  function flatten(profile: Profile): Item[] {
    const items: Item[] = []
    const person = profile.pathfinders[0]
    for (const key of ['first_name', 'last_name', 'birth_date', 'notes', 'years_active']) {
      items.push({ key, label: labels[key], text: display(person[key], key) })
    }
    for (const entry of person.levels as Row[])
      items.push({
        key: `level:${entry.name}:${entry.year}`,
        label: `Levels / ${entry.name}`,
        text: describe(entry),
      })
    for (const row of profile.current_data)
      for (const key of ['school_year', 'status', 'current_title', 'current_activities']) {
        items.push({
          key: `registration:${key}`,
          label: `Current Registration / ${labels[key]}`,
          text: display(row[key], key),
        })
      }
    for (const [table, label] of Object.entries(tables))
      for (const [index, row] of profile[table].entries()) {
        if (Array.isArray(row.history))
          for (const entry of row.history as Row[]) {
            items.push({
              key: `${table}:${entry.year}`,
              label,
              text: describe(entry, table === 'pbe'),
            })
          }
        else items.push({ key: `${table}:${row.id ?? `new-${index}`}`, label, text: describe(row) })
      }
    return items
  }
  const before = flatten(original),
    after = flatten(proposed)
  const remaining = [...after]
  const changes: ProfileChange[] = []
  const unmatched: Item[] = []
  // Match unchanged instances first so removing one never disguises an untouched duplicate.
  for (const item of before) {
    const index = remaining.findIndex((next) => next.key === item.key && next.text === item.text)
    if (index >= 0) remaining.splice(index, 1)
    else unmatched.push(item)
  }
  for (const item of unmatched) {
    const index = remaining.findIndex((next) => next.key === item.key)
    if (index >= 0) {
      const next = remaining.splice(index, 1)[0]
      changes.push({ kind: 'Updated', label: item.label, before: item.text, after: next.text })
    } else changes.push({ kind: 'Removed', label: item.label, before: item.text })
  }
  for (const item of remaining) changes.push({ kind: 'Added', label: item.label, after: item.text })
  return changes
}
