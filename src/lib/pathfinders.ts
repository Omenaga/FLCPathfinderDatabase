import { getSupabase } from './supabase'
import type { Database } from './database.types'

export const LEVELS = ['Friend', 'Companion', 'Explorer', 'Ranger', 'Voyager', 'Guide', 'Pioneer', 'Navigator'] as const
export const ACTIVITIES = ['Drill', 'Drums', 'PBE', 'TLT'] as const
export const EVENTS = ['Drill Performance', 'Drum Performance', 'Honor Evaluations', 'Bible Events', 'Knots Relay', 'Tents', 'Jump Rope', 'Archery', 'Lashing', 'Burning Twine'] as const
export const PAGE_SIZE = 25
type EarnedLevel = { name: string; advanced: boolean }
type MemberRow = Database['public']['Tables']['pathfinders']['Row']

function member(row: MemberRow) {
  return { ...row, years_active: row.years_active as string[], levels: row.levels as EarnedLevel[],
    extracurriculars: row.extracurriculars as string[], red_zone_participation: row.red_zone_participation as string[] }
}
export type Pathfinder = ReturnType<typeof member>
export type Filters = { name: string; year: string; level: string; advanced: string; activity: string; event: string }
export const EMPTY_FILTERS: Filters = { name: '', year: '', level: '', advanced: '', activity: '', event: '' }

export async function searchPathfinders(filters: Filters, page: number, signal: AbortSignal) {
  let query = getSupabase().from('pathfinders').select('*', { count: 'exact' })
  const name = filters.name.trim()
  if (name) query = query.ilike('name', `%${name.replace(/[\\%_]/g, '\\$&')}%`)
  // Supabase treats JS arrays as PostgreSQL arrays; JSONB arrays need JSON text.
  const yearText = filters.year.trim()
  if (yearText) {
    if (!/^[0-9]{4}$/.test(yearText) || Number(yearText) < 1900) {
      throw new Error('Enter a four-digit year, such as 2014.')
    }
    const year = Number(yearText)
    query = query.or(`years_active.cs.["${year - 1}-${year}"],years_active.cs.["${year}-${year + 1}"]`)
  }
  if (filters.level) query = query.contains('levels', JSON.stringify([{ name: filters.level,
    ...(filters.advanced ? { advanced: filters.advanced === 'true' } : {}) }]))
  if (filters.activity) query = query.contains('extracurriculars', JSON.stringify([filters.activity]))
  if (filters.event) query = query.contains('red_zone_participation', JSON.stringify([filters.event]))
  const { data, count, error } = await query.order('name').order('id')
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1).abortSignal(signal)
  if (error) throw error
  return { members: (data ?? []).map(member), count: count ?? 0 }
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
