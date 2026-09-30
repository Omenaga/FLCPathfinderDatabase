// Turn two database snapshots into a human-readable receipt, hiding internal IDs and unchanged values.

import type { Json } from '../../lib/database.types'
import { statusLabel } from '../../lib/format'

type Row = Record<string, Json>
type Profile = Record<string, Row[]>
type Item = { key: string; label: string; text: string; year?: string; detail?: string }
export type ProfileChange = {
  kind: 'Added' | 'Updated' | 'Removed'
  label: string
  before?: string
  after?: string
}
// Only fields in this dictionary appear in the receipt; internal IDs are intentionally excluded.
const labels: Record<string, string> = {
  first_name: 'First Name',
  last_name: 'Last Name',
  birth_date: 'Birthday',
  notes: 'Notes',
  years_active: 'Years Active',
  school_year: 'School Year',
  status: 'Status',
  current_title: 'Class/Titles',
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
  drill: 'Drill',
  drum_corps: 'Drums',
  pbe: 'PBE',
  tlt: 'TLT',
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
  honors_earned: 'Honors',
}
export function profileChanges(
  original: Profile,
  proposed: Profile,
  honors: { id: number; name: string }[],
): ProfileChange[] {
  // Normalize missing values, arrays, nested objects, and catalog IDs into readable comparison text.
  function display(value: Json | undefined, key: string): string {
    if (value === null || value === undefined || value === '')
      return ['year', 'year_earned', 'years'].includes(key) ? 'Unknown' : 'Not Recorded'
    if (Array.isArray(value))
      return value.length
        ? value
            .map((item) => display(item, key))
            .sort((a, b) =>
              (a === 'Unknown' ? '\uffff' : a).localeCompare(
                b === 'Unknown' ? '\uffff' : b,
                undefined,
                { sensitivity: 'base' },
              ),
            )
            .join(', ')
        : 'None'
    if (typeof value === 'object')
      return (
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([field, item]) => `${labels[field] ?? field}: ${display(item, field)}`)
          .join('; ') || 'None'
      )
    if (key === 'honor_id')
      return honors.find((honor) => honor.id === value)?.name ?? 'Unlisted Honor'
    if (key === 'status' || key === 'outcome') return statusLabel(String(value))
    return String(value)
  }
  // Describe visible row fields. PBE books are derived from the year and omitted from history receipts.
  function describe(row: Row, omitBooks = false) {
    return Object.entries(row)
      .filter(([key]) => key in labels && !(omitBooks && key === 'books'))
      .sort(([a], [b]) => {
        const yearFields = ['year', 'year_earned', 'years']
        return (
          Number(yearFields.includes(b)) - Number(yearFields.includes(a)) ||
          labels[a].localeCompare(labels[b])
        )
      })
      .map(([key, value]) => `${labels[key]}: ${display(value, key)}`)
      .join('; ')
  }
  function order(row: Row) {
    const years = Array.isArray(row.years)
      ? row.years.filter((year) => typeof year === 'string').sort()
      : []
    return {
      year: String(row.year ?? row.year_earned ?? years[0] ?? '9999'),
      detail: [
        'name',
        'team',
        'honor_id',
        'titles',
        'drums',
        'operations',
        'results',
        'placement',
        'outcome',
      ]
        .filter((key) => row[key] !== undefined)
        .map((key) => display(row[key], key))
        .join('; '),
    }
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
        ...order(entry),
      })
    for (const row of profile.current_data)
      for (const key of ['school_year', 'status', 'current_title']) {
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
              ...order(entry),
            })
          }
        else
          items.push({
            key: `${table}:${row.id ?? `new-${index}`}`,
            label,
            text: describe(row),
            ...order(row),
          })
      }
    return items
  }
  const before = flatten(original),
    after = flatten(proposed)
  const remaining = [...after]
  const changes: ProfileChange[] = []
  const ordering = new Map<ProfileChange, Item>()
  function append(change: ProfileChange, item: Item) {
    changes.push(change)
    ordering.set(change, item)
  }
  const unmatched: Item[] = []
  // Match unchanged instances first so removing one never disguises an untouched duplicate.
  for (const item of before) {
    const index = remaining.findIndex((next) => next.key === item.key && next.text === item.text)
    if (index >= 0) remaining.splice(index, 1)
    else unmatched.push(item)
  }
  // After unchanged pairs are removed, a matching key means an update; no matching key means a removal.
  for (const item of unmatched) {
    const index = remaining.findIndex((next) => next.key === item.key)
    if (index >= 0) {
      const next = remaining.splice(index, 1)[0]
      append({ kind: 'Updated', label: item.label, before: item.text, after: next.text }, next)
    } else append({ kind: 'Removed', label: item.label, before: item.text }, item)
  }
  // Anything still unpaired exists only in the proposed snapshot, so it is an addition.
  for (const item of remaining) append({ kind: 'Added', label: item.label, after: item.text }, item)
  const sections = [
    'First Name',
    'Last Name',
    'Birthday',
    'Notes',
    'Years Active',
    'Current Registration',
    'Levels',
    ...Object.values(tables),
  ]
  return changes.sort((a, b) => {
    const left = ordering.get(a)!,
      right = ordering.get(b)!
    return (
      sections.indexOf(left.label.split(' / ')[0]) -
        sections.indexOf(right.label.split(' / ')[0]) ||
      (left.year ?? '').localeCompare(right.year ?? '') ||
      (left.detail ?? left.label).localeCompare(right.detail ?? right.label, undefined, {
        sensitivity: 'base',
      })
    )
  })
}
