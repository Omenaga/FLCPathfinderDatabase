import { getSupabase } from './supabase'
import type { Database } from './database.types'

export const LEVELS = ['Friend', 'Companion', 'Explorer', 'Ranger', 'Voyager', 'Guide', 'Pioneer', 'Navigator'] as const
export const LEVEL_OPTIONS = LEVELS.flatMap(level => [level, `${level} (Advanced)`])
export const ACTIVITIES = ['Drill', 'Drums', 'PBE', 'TLT'] as const
export const EVENTS = ['Drill Performance', 'Drum Performance', 'Honor Evaluations', 'Bible Events', 'Knots Relay', 'Tents', 'Jump Rope', 'Archery', 'Lashing', 'Burning Twine'] as const
export const STATUSES = ['New', 'Returning', 'Graduated', 'Unregistered'] as const
export const YEARS = Array.from({ length: Math.max(0, new Date().getFullYear() - 2009) }, (_, index) => String(2010 + index))
export const PAGE_SIZE = 25
type EarnedLevel = { name: string; advanced: boolean }
type MemberRow = Database['public']['Tables']['pathfinders']['Row']

function member(row: MemberRow) {
  return { ...row, years_active: row.years_active as string[], levels: row.levels as EarnedLevel[],
    extracurriculars: row.extracurriculars as string[], red_zone_participation: row.red_zone_participation as string[] }
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
    name: option.replace(/ \(Advanced\)$/, ''), advanced: option.endsWith(' (Advanced)'),
  }))))
  if (filters.activity.length) query = query.contains('search_activities', JSON.stringify(filters.activity))
  if (filters.event.length) query = query.contains('red_zone_participation', JSON.stringify(filters.event))
  const { data, count, error } = await query.order('name').order('id')
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1).abortSignal(signal)
  if (error) throw error
  return { members: (data ?? []), count: count ?? 0 }
}

export async function getPathfinder(id: number, signal: AbortSignal) {
  const { data, error } = await getSupabase().from('pathfinders').select(`
    *, honors_earned(*, honors(name)), drill(*), drum_corps(*), pbe(*), tlt(*),
    red_zone_drill_performance(*), red_zone_drum_performance(*), red_zone_honor_evaluations(*),
    red_zone_bible_events(*), red_zone_knots(*), red_zone_tents(*), red_zone_jump_rope(*),
    red_zone_archery(*), red_zone_lashing(*), red_zone_burning_twine(*)
  `).eq('id', id).abortSignal(signal).single()
  if (error) throw error
  const activities = [
    { name: 'Drill', records: data.drill ? [{ years: data.drill.years as string[], detail: 'Participation' }] : [] },
    { name: 'Drums', records: data.drum_corps.map(r => ({ years: r.years as string[], detail: r.drum_played })) },
    { name: 'PBE', records: data.pbe.map(r => ({ years: r.years as string[], detail: r.bible_book })) },
    { name: 'TLT', records: data.tlt.map(r => ({ years: r.years as string[], detail: r.tlt_operation })) },
  ].filter(group => (data.extracurriculars as string[]).includes(group.name))
  const eventRows = [data.red_zone_drill_performance, data.red_zone_drum_performance,
    data.red_zone_honor_evaluations, data.red_zone_bible_events, data.red_zone_knots,
    data.red_zone_tents, data.red_zone_jump_rope, data.red_zone_archery,
    data.red_zone_lashing, data.red_zone_burning_twine]
  const events = EVENTS.map((name, index) => ({ name, records: eventRows[index].map(r => ({
    year: r.year, placement: r.placement, name: 'name' in r ? r.name : undefined,
  })).sort((a, b) => b.year - a.year) })).filter(group => (data.red_zone_participation as string[]).includes(group.name))
  return { member: member(data), activities, events,
    honors: data.honors_earned.map(r => ({ name: r.honors.name, year: r.year_earned })).sort((a, b) => b.year - a.year) }
}
export type PathfinderDetails = Awaited<ReturnType<typeof getPathfinder>>
