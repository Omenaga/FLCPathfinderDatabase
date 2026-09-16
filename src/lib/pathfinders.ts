import { getSupabase } from './supabase'
import type { Database } from './database.types'

export const LEVELS = ['Friend', 'Companion', 'Explorer', 'Ranger', 'Voyager', 'Guide', 'Pioneer', 'Navigator'] as const
export const ACTIVITIES = ['Drill', 'Drums', 'PBE', 'TLT'] as const
export const EVENTS = ['Drill Performance', 'Drum Performance', 'Honor Evaluations', 'Bible Events', 'Knots Relay', 'Tents', 'Jump Rope', 'Archery', 'Lashing', 'Burning Twine'] as const
export const STATUSES = ['Pathfinder', 'Staff', 'Parent', 'Not Active'] as const
export const YEARS = Array.from({ length: Math.max(0, new Date().getFullYear() - 2009) }, (_, index) => String(2010 + index))
export const period = (year: number) => `${year}-${String(year + 1).slice(-2)}`
export const PERIODS = YEARS.map(year => period(Number(year)))
export const LEVEL_DETAILS: Record<string, readonly string[]> = Object.fromEntries(LEVELS.map(level => [level, ['Basic', 'Advanced', 'Incomplete']]))
export const DRUMS = ['Snare', 'Quad', 'Bass', 'Tenor', 'Cymbol'] as const
export const OPERATIONS = ['Administrative', 'Outreach', 'Teaching', 'Activity', 'Records', 'Counseling'] as const
export const PBE_REGIONS = ['Area', 'State', 'Union', 'Divisional'] as const
export const PLACEMENTS = ['1st Place', '2nd Place', '3rd Place', 'Participation'] as const
export const ACTIVITY_DETAILS: Record<string, readonly string[]> = { Drill: ['Precision', 'Freestyle', 'Adult'], Drums: DRUMS, PBE: PBE_REGIONS.flatMap(region => [region, ...PLACEMENTS.map(placement => `${region} / ${placement}`)]), TLT: OPERATIONS }
export const EVENT_DETAILS: Record<string, readonly string[]> = Object.fromEntries(EVENTS.map(event => [event, PLACEMENTS]))
function historyOptions(names: readonly string[], details: Record<string, readonly string[]>) {
  return names.flatMap(name => [name, ...(details[name] ?? []).map(detail => `${name} / ${detail}`)])
}
export const LEVEL_OPTIONS = historyOptions(LEVELS, LEVEL_DETAILS)
export const ACTIVITY_OPTIONS = historyOptions(ACTIVITIES, ACTIVITY_DETAILS)
export const EVENT_OPTIONS = historyOptions(EVENTS, EVENT_DETAILS)
export function historyFilter(option: string) {
  const [name, ...parts] = option.split(' / ')
  const detail = parts.join(' / ')
  return { name, ...(detail ? { detail } : {}) }
}
export const PAGE_SIZE = 25
type EarnedLevel = { name: string; outcome: 'basic' | 'advanced' | 'incomplete'; year: string | null }
type MemberRow = Database['public']['Tables']['pathfinders']['Row']

function member(row: MemberRow) {
  return { ...row, years_active: row.years_active as string[], levels: row.levels as EarnedLevel[] }
}
export type Pathfinder = Database['public']['Views']['member_search']['Row']
export type Filters = { status: string; name: string; year: string[]; level: string[]; activity: string[]; event: string[] }
export const EMPTY_FILTERS: Filters = { status: '', name: '', year: [], level: [], activity: [], event: [] }

// Quote the entire JSON operand for PostgREST's logical-expression grammar.
function contains(column: string, value: unknown) {
  const operand = JSON.stringify([value]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `${column}.cs."${operand}"`
}
export function historySearchExpression(filters: Filters) {
  if (filters.year.some(year => ![...YEARS, ...PERIODS].includes(year))) throw new Error('Select a valid year or period.')
  for (const [values, options] of [[filters.level, LEVEL_OPTIONS], [filters.activity, ACTIVITY_OPTIONS], [filters.event, EVENT_OPTIONS]] as const) {
    if (values.some(value => !options.includes(value))) throw new Error('Select a valid history option.')
  }
  const years = [...new Set(filters.year)]
  const periods = [...new Set(years.flatMap(year => year.includes('-') ? [year] : [period(Number(year) - 1), period(Number(year))]))]
  const groups: string[] = []
  const any = (clauses: string[]) => `or(${[...new Set(clauses)].join(',')})`
  if (filters.level.length) groups.push(any(filters.level.flatMap(option => {
    const { name, detail } = historyFilter(option)
    const base = { name, ...(detail ? { outcome: detail.toLowerCase() } : {}) }
    return periods.length ? periods.map(year => contains('levels', { ...base, year })) : [contains('levels', base)]
  })))
  for (const [options, prefix, namesColumn] of [[filters.activity, 'search_activity', 'search_activities'], [filters.event, 'search_event', 'search_events']] as const) {
    if (!options.length) continue
    groups.push(any(options.flatMap(option => {
      const { name, detail } = historyFilter(option)
      if (detail) {
        const base = { name, detail }
        return years.length ? years.map(year => contains(`${prefix}_details`, { ...base, year: year.includes('-') ? year : Number(year) })) : [contains(`${prefix}_details`, base)]
      }
      return years.length ? years.map(year => contains(`${prefix}_years`, `${name} (${year})`)) : [contains(namesColumn, name)]
    })))
  }
  // Without category selections, the shared year control still browses participation years.
  if (!groups.length && periods.length) groups.push(any(periods.map(year => contains('search_years', year))))
  return groups.length ? `and(${groups.join(',')})` : ''
}

export async function searchPathfinders(filters: Filters, page: number, signal: AbortSignal, excludePathfinders = false) {
  let query = getSupabase().from('member_search').select('*', { count: 'exact' })
  if (filters.status) query = query.eq('status', filters.status.toLowerCase().replaceAll(' ', '_'))
  if (excludePathfinders) query = query.neq('status', 'pathfinder')
  const name = filters.name.trim()
  if (name) query = query.ilike('name', `%${name.replace(/[\\%_]/g, '\\$&')}%`)
  const expression = historySearchExpression(filters)
  if (expression) query = query.or(expression)
  const { data, count, error } = await query.order('sort_status').order('sort_title').order('sort_last_name').order('sort_first_name').order('id')
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1).abortSignal(signal)
  if (error) throw error
  return { members: (data ?? []), count: count ?? 0 }
}

export async function getPathfinder(id: number, signal: AbortSignal) {
  const { data, error } = await getSupabase().from('pathfinders').select(`
    *, staff_history(*), drill(*), drum_corps(*), pbe(*), tlt(*),
    red_zone_drill_performance(*), red_zone_drum_performance(*), red_zone_honor_evaluations(*),
    red_zone_bible_events(*), red_zone_knots(*), red_zone_tents(*), red_zone_jump_rope(*),
    red_zone_archery(*), red_zone_lashing(*), red_zone_burning_twine(*)
  `).eq('id', id).abortSignal(signal).single()
  if (error) throw error
  const roles = (['pathfinder', 'staff'] as const).map(role => {
    const activities = [
      { name: 'Drill', records: data.drill.map(r => ({ years: r.years as (string | null)[], detail: r.team ?? 'Team not recorded' })) },
      { name: 'Drums', records: ((data.drum_corps?.history ?? []) as { year: string | null; drums: string[] }[]).map(entry => ({ years: [entry.year], detail: entry.drums.join(', ') || 'Instrument not recorded' })) },
      { name: 'PBE', records: ((data.pbe?.history ?? []) as { year: string | null; books: string[]; results?: Record<string, string> }[]).map(entry => ({ years: [entry.year], detail: PBE_REGIONS.filter(region => entry.results?.[region]).map(region => `${region} (${entry.results![region] === 'Participation' ? 'P' : entry.results![region].replace(' Place', '')})`).join(', ') || 'Results not recorded' })) },
      { name: 'TLT', records: ((data.tlt?.history ?? []) as { year: string | null; operations: string[] }[]).map(entry => ({ years: [entry.year], detail: entry.operations.join(', ') })) },
    ].filter(group => group.records.length > 0)
    const eventRows = [data.red_zone_drill_performance, data.red_zone_drum_performance,
      data.red_zone_honor_evaluations, data.red_zone_bible_events, data.red_zone_knots,
      data.red_zone_tents, data.red_zone_jump_rope, data.red_zone_archery,
      data.red_zone_lashing, data.red_zone_burning_twine]
    const events = EVENTS.map((name, index) => ({ name, records: eventRows[index].map(r => ({
      year: r.year, placement: r.placement, name: 'name' in r && typeof r.name === 'string' ? r.name : undefined,
    })).sort((a, b) => a.year === null ? (b.year === null ? 0 : 1) : b.year === null ? -1 : b.year.localeCompare(a.year)) })).filter(group => group.records.length > 0)
    return { role, activities: role === 'pathfinder' ? activities : [], events: role === 'pathfinder' ? events : [] }
  })
  return { member: member(data), roles, staffHistory: (data.staff_history?.history ?? []) as { year: string | null; titles: string[] }[] }
}
export async function saveProfileNotes(id: number, notes: string, signal: AbortSignal) {
  const { data, error } = await getSupabase().from('pathfinders').update({ notes }).eq('id', id).select('id').abortSignal(signal).single()
  if (error) throw error
  return data
}

export type PathfinderDetails = Awaited<ReturnType<typeof getPathfinder>>
