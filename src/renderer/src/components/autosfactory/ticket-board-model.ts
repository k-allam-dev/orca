import type {
  TicketAgentStatus,
  TicketRecord,
  TicketState
} from '../../../../shared/autosfactory/ticket-state'
import {
  TICKET_FLAGS,
  type TicketFlag,
  type TicketFlags
} from '../../../../shared/autosfactory/ticket-flags'
import type { AgentDotState } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'

export function ticketStateLabel(state: TicketState): string {
  switch (state) {
    case 'new':
      return translate('autosfactory.state.new', 'New')
    case 'planning':
      return translate('autosfactory.state.planning', 'Planning')
    case 'plan-ready-for-review':
      return translate('autosfactory.state.planReady', 'Plan ready for review')
    case 'implementing':
      return translate('autosfactory.state.implementing', 'Implementing')
    case 'waiting-on-you':
      return translate('autosfactory.state.waitingOnYou', 'Waiting on you')
    case 'changes-ready-for-review':
      return translate('autosfactory.state.changesReady', 'Changes ready for review')
    case 'pr-open':
      return translate('autosfactory.state.prOpen', 'PR open')
    case 'done':
      return translate('autosfactory.state.done', 'Done')
  }
}

export function agentStatusLabel(status: TicketAgentStatus): string {
  switch (status) {
    case 'idle':
      return translate('autosfactory.agentStatus.idle', 'Idle')
    case 'running':
      return translate('autosfactory.agentStatus.running', 'Running')
    case 'paused':
      return translate('autosfactory.agentStatus.paused', 'Paused')
    case 'interrupted':
      return translate('autosfactory.agentStatus.interrupted', 'Interrupted')
    case 'failed':
      return translate('autosfactory.agentStatus.failed', 'Failed')
  }
}

export function agentStatusDotState(status: TicketAgentStatus): AgentDotState {
  switch (status) {
    case 'running':
      return 'working'
    case 'paused':
      return 'waiting'
    case 'idle':
    case 'interrupted':
    case 'failed':
      return status
  }
}

export function ticketFlagLabel(flag: TicketFlag): string {
  switch (flag) {
    case 'permissionRequest':
      return translate('autosfactory.flag.permissionRequest', 'Permission request')
    case 'jiraChanged':
      return translate('autosfactory.flag.jiraChanged', 'Jira changed')
    case 'usageLimit':
      return translate('autosfactory.flag.usageLimit', 'Usage limit')
    case 'queued':
      return translate('autosfactory.flag.queued', 'Queued')
  }
}

export function activeTicketFlags(flags: TicketFlags | undefined): TicketFlag[] {
  return TICKET_FLAGS.filter((flag) => flags?.[flag] === true)
}

export function groupTicketsByState(
  tickets: readonly TicketRecord[]
): Record<TicketState, TicketRecord[]> {
  const grouped: Record<TicketState, TicketRecord[]> = {
    new: [],
    planning: [],
    'plan-ready-for-review': [],
    implementing: [],
    'waiting-on-you': [],
    'changes-ready-for-review': [],
    'pr-open': [],
    done: []
  }
  for (const ticket of tickets) {
    grouped[ticket.state].push(ticket)
  }
  return grouped
}
