import { getSupabase } from './supabase'
import type { Database } from './database.types'

export const LEVELS = ['Friend', 'Companion', 'Explorer', 'Ranger', 'Voyager', 'Guide', 'Pioneer', 'Navigator'] as const
export const LEVEL_OPTIONS = LEVELS.flatMap(level => [`${level} (Any)`, level, `${level} (Advanced)`])
export const ACTIVITIES = ['Drill', 'Drums', 'PBE', 'TLT'] as const
export const EVENTS = ['Drill Performance', 'Drum Performance', 'Honor Evaluations', 'Bible Events', 'Knots Relay', 'Tents', 'Jump Rope', 'Archery', 'Lashing', 'Burning Twine'] as const
export const STATUSES = ['New', 'Returning', 'Graduated', 'Unregistered'] as const
export const YEARS = Array.from({ length: Math.max(0, new Date().getFullYear() - 2009) }, (_, index) => String(2010 + index))
export const ACTIVITY_OPTIONS = ACTIVITIES.flatMap(activity => [activity, ...YEARS
  .filter(year => activity !== 'TLT' || Number(year) >= 2017)
  .map(year => `${activity} (${year})`)])
export const EVENT_OPTIONS = EVENTS.flatMap(event => [event, ...YEARS.map(year => `${event} (${year})`)])
export const PAGE_SIZE = 25
type EarnedLevel = { name: string; advanced: boolean }
type MemberRow = Database['public']['Tables']['pathfinders']['Row']

function member(row: MemberRow) {
  return { ...row, years_active: row.years_active as string[], levels: row.levels as EarnedLevel[] }
}
export type Pathfinder = Database['public']['Views']['member_search']['Row']
export type Filters = { status: string; name: string; year: string[]; level: string[]; activity: string[]; event: string[] }
export const EMPTY_FILTERS: Filters = { status: '', name: '', year: [], level: [], activity: [], event: [] }

export async function searchPathfinders(filters: Filters, page: number, signal: AbortSignal) {
  let query = getSupabase().from('member_search').select('*', { count: 'exact' })
  if (filters.status) query = query.eq('status', filters.status.toLowerCase())
  const name = filters.name.trim()
  if (name) query = query.ilike('name', `%${name.replace(/[\\%_]/g, '\\$&')}%`)
  // Supabase treats JS arrays as PostgreSQL arrays; JSONB arrays need JSON text.
  if (filters.year.length) {
    const conditions = [...new Set(filters.year)].map(value => {
      if (!YEARS.includes(value)) throw new Error('Select a year from 2010 through the current year.')
      const year = Number(value)
      return `or(search_years.cs.["${year - 1}-${year}"],search_years.cs.["${year}-${year + 1}"])`
    })
    // Each calendar year may match either adjacent school year; all selected years must match.
    query = query.or(`and(${conditions.join(',')})`)
  }
  if (filters.level.length) query = query.contains('levels', JSON.stringify(filters.level.map(option => ({
    name: option.replace(/ \((?:Advanced|Any)\)$/, ''),
    ...(option.endsWith(' (Any)') ? {} : { advanced: option.endsWith(' (Advanced)') }),
  }))))
  if (filters.activity.some(option => !ACTIVITY_OPTIONS.includes(option))) throw new Error('Select a valid activity and year.')
  const anyYear = filters.activity.filter(option => !option.includes(' ('))
  const dated = filters.activity.filter(option => option.includes(' ('))
  if (anyYear.length) query = query.contains('search_activities', JSON.stringify(anyYear))
  if (dated.length) query = query.contains('search_activity_years', JSON.stringify(dated))
  if (filters.event.some(option => !EVENT_OPTIONS.includes(option))) throw new Error('Select a valid event and year.')
  const anyEventYear = filters.event.filter(option => !option.includes(' ('))
  const datedEvents = filters.event.filter(option => option.includes(' ('))
  if (anyEventYear.length) query = query.contains('search_events', JSON.stringify(anyEventYear))
  if (datedEvents.length) query = query.contains('search_event_years', JSON.stringify(datedEvents))
  const { data, count, error } = await query.order('name').order('id')
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1).abortSignal(signal)
  if (error) throw error
  return { members: (data ?? []), count: count ?? 0 }
}

export async function getPathfinder(id: number, signal: AbortSignal) {
  const { data, error } = await getSupabase().from('pathfinders').select(`
    *, drill(*), drum_corps(*), pbe(*), tlt(*),
    red_zone_drill_performance(*), red_zone_drum_performance(*), red_zone_honor_evaluations(*),
    red_zone_bible_events(*), red_zone_knots(*), red_zone_tents(*), red_zone_jump_rope(*),
    red_zone_archery(*), red_zone_lashing(*), red_zone_burning_twine(*)
  `).eq('id', id).abortSignal(signal).single()
  if (error) throw error
  const activities = [
    { name: 'Drill', records: data.drill ? [{ years: data.drill.years as string[], detail: 'Participation' }] : [] },
    { name: 'Drums', records: data.drum_corps.map(r => ({ years: r.years as string[], detail: r.drum_played })) },
    { name: 'PBE', records: ((data.pbe?.history ?? []) as { year: string; books: string[] }[]).map(entry => ({ years: [entry.year], detail: entry.books.join(', ') })) },
    { name: 'TLT', records: ((data.tlt?.history ?? []) as { year: number; operations: string[] }[]).map(entry => ({ years: [String(entry.year)], detail: entry.operations.join(', ') })) },
  ].filter(group => group.records.length > 0)
  const eventRows = [data.red_zone_drill_performance, data.red_zone_drum_performance,
    data.red_zone_honor_evaluations, data.red_zone_bible_events, data.red_zone_knots,
    data.red_zone_tents, data.red_zone_jump_rope, data.red_zone_archery,
    data.red_zone_lashing, data.red_zone_burning_twine]
  const events = EVENTS.map((name, index) => ({ name, records: eventRows[index].map(r => ({
    year: r.year, placement: r.placement, name: 'name' in r && typeof r.name === 'string' ? r.name : undefined,
  })).sort((a, b) => b.year - a.year) })).filter(group => group.records.length > 0)
  return { member: member(data), activities, events }
}
export type PathfinderDetails = Awaited<ReturnType<typeof getPathfinder>>
