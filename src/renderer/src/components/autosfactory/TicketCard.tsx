import { memo } from 'react'
import { AgentTypeIcon } from '@/lib/agent-type-icon'
import { AgentStateDot } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import {
  TICKET_STATES,
  type TicketRecord,
  type TicketState
} from '../../../../shared/autosfactory/ticket-state'
import type { TicketFlags } from '../../../../shared/autosfactory/ticket-flags'
import {
  activeTicketFlags,
  agentStatusDotState,
  agentStatusLabel,
  ticketFlagLabel,
  ticketStateLabel
} from './ticket-board-model'

export const TICKET_DRAG_TYPE = 'application/x-autosfactory-ticket'

type TicketCardProps = {
  ticket: TicketRecord
  flags?: TicketFlags
  onMove: (key: string, state: TicketState) => void
  onOpen?: (ticket: TicketRecord) => void
}

export const TicketCard = memo(function TicketCard({
  ticket,
  flags,
  onMove,
  onOpen
}: TicketCardProps): React.JSX.Element {
  const activeFlags = activeTicketFlags(flags)
  return (
    <div
      draggable
      onClick={() => onOpen?.(ticket)}
      title={translate('autosfactory.card.open', 'Click to open its terminal')}
      data-ticket-key={ticket.key}
      onDragStart={(event) => {
        event.dataTransfer.setData(TICKET_DRAG_TYPE, ticket.key)
        event.dataTransfer.effectAllowed = 'move'
      }}
      className="flex w-full cursor-grab flex-col gap-1.5 rounded-lg border border-border/60 bg-card p-2.5 text-left transition-colors hover:border-border hover:bg-accent/40 active:cursor-grabbing"
    >
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {ticket.key}
        </span>
        <AgentStateDot state={agentStatusDotState(ticket.agentStatus)} className="ml-auto" />
      </div>
      <div className="line-clamp-2 text-xs leading-snug text-foreground/90">{ticket.title}</div>
      {ticket.lastError ? (
        <div className="line-clamp-2 text-[11px] text-red-600" data-autosfactory-last-error="">
          {ticket.lastError}
        </div>
      ) : null}
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {ticket.agent ? (
          <>
            <span className="inline-flex shrink-0">
              <AgentTypeIcon agentType={ticket.agent} size={12} />
            </span>
            <span className="capitalize">{ticket.agent}</span>
          </>
        ) : (
          <span>{translate('autosfactory.card.noAgent', 'No agent')}</span>
        )}
        <span className="ml-auto">{agentStatusLabel(ticket.agentStatus)}</span>
      </div>
      {activeFlags.length > 0 ? (
        <ul
          className="flex flex-wrap gap-1"
          aria-label={translate('autosfactory.card.flags', 'Flags')}
        >
          {activeFlags.map((flag) => (
            <li
              key={flag}
              className="rounded-full border border-agent-question/30 bg-agent-question/10 px-1.5 py-px text-[10px] leading-none text-agent-question-text"
            >
              {ticketFlagLabel(flag)}
            </li>
          ))}
        </ul>
      ) : null}
      <select
        aria-label={translate('autosfactory.card.moveTo', 'Move {{key}} to', { key: ticket.key })}
        value={ticket.state}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const next = TICKET_STATES.find((state) => state === event.target.value)
          if (next) {
            onMove(ticket.key, next)
          }
        }}
        className="w-full rounded-md border border-border/60 bg-background px-1 py-0.5 text-[11px] text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {TICKET_STATES.map((state) => (
          <option key={state} value={state}>
            {ticketStateLabel(state)}
          </option>
        ))}
      </select>
    </div>
  )
})
