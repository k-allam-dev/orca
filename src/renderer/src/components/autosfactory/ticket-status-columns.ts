import type { WorkspaceStatusDefinition } from '../../../../shared/worktree/types'
import type { TicketState } from '../../../../shared/autosfactory/ticket-state'

// Why: four ids reuse Orca's own (todo, in-progress, in-review, completed) so existing workspaces keep their column with no data migration.
const STATE_STATUS: Record<TicketState, string> = {
  new: 'todo',
  planning: 'planning',
  'plan-ready-for-review': 'plan-ready-for-review',
  implementing: 'in-progress',
  'waiting-on-you': 'waiting-on-you',
  'changes-ready-for-review': 'in-review',
  'pr-open': 'pr-open',
  done: 'completed'
}

export const TICKET_STATE_COLUMNS: WorkspaceStatusDefinition[] = [
  { id: 'todo', label: 'New', color: 'neutral', icon: 'circle' },
  { id: 'planning', label: 'Planning', color: 'conductor-progress', icon: 'conductor-progress' },
  {
    id: 'plan-ready-for-review',
    label: 'Plan ready for review',
    color: 'conductor-review',
    icon: 'conductor-review'
  },
  {
    id: 'in-progress',
    label: 'Implementing',
    color: 'conductor-progress',
    icon: 'conductor-progress'
  },
  {
    id: 'waiting-on-you',
    label: 'Waiting on you',
    color: 'conductor-review',
    icon: 'conductor-review'
  },
  {
    id: 'in-review',
    label: 'Changes ready for review',
    color: 'conductor-review',
    icon: 'conductor-review'
  },
  { id: 'pr-open', label: 'PR open', color: 'conductor-review', icon: 'conductor-review' },
  { id: 'completed', label: 'Done', color: 'conductor-done', icon: 'conductor-done' }
]

export function statusForTicketState(state: TicketState): string {
  return STATE_STATUS[state]
}

export function ticketStateForStatus(status: string | undefined): TicketState {
  const match = (Object.keys(STATE_STATUS) as TicketState[]).find(
    (state) => STATE_STATUS[state] === status
  )
  return match ?? 'new'
}

const LEGACY_IDS = ['todo', 'in-progress', 'in-review', 'completed']

export function isLegacyDefaultColumns(statuses: readonly { id: string }[]): boolean {
  return statuses.length === LEGACY_IDS.length && statuses.every((s, i) => s.id === LEGACY_IDS[i])
}
