import { LEVELS } from './pathfinders'

export function statusLabel(status: string | null) {
  return status === 'not_active' || !status ? 'Not Active' : status[0].toUpperCase() + status.slice(1)
}
export function detailKind(name: string) {
  if (name === 'Drill') return 'team'
  if (name === 'Drums') return 'instrument'
  if (name === 'TLT') return 'operation'
  return (LEVELS as readonly string[]).includes(name) ? 'outcome' : 'placement'
}
