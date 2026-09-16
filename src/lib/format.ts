// Shared display labels keep database values and user-facing wording consistent.

import { LEVELS } from './pathfinders'

// Missing registration is displayed as Not Active; other values receive an initial capital.
export function statusLabel(status: string | null) {
  return status === 'not_active' || !status
    ? 'Not Active'
    : status[0].toUpperCase() + status.slice(1)
}
// Choose the noun used in the detail dropdown for each activity or achievement category.
export function detailKind(name: string) {
  if (name === 'Drill') return 'team'
  if (name === 'Drums') return 'instrument'
  if (name === 'PBE') return 'region'
  if (name === 'TLT') return 'operation'
  return (LEVELS as readonly string[]).includes(name) ? 'outcome' : 'placement'
}
