import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  TICKET_STATES,
  type TicketRecord,
  type TicketState
} from '../../../../shared/autosfactory/ticket-state'
import type { TicketFlags } from '../../../../shared/autosfactory/ticket-flags'
import { TICKET_DRAG_TYPE, TicketCard } from './TicketCard'
import { groupTicketsByState, ticketStateLabel } from './ticket-board-model'

type TicketBoardProps = {
  tickets: readonly TicketRecord[]
  flagsByKey?: Readonly<Record<string, TicketFlags>>
  onMoveTicket: (key: string, state: TicketState) => void
  containerClassName?: string
}

function TicketColumn({
  state,
  tickets,
  flagsByKey,
  onMoveTicket
}: {
  state: TicketState
  tickets: readonly TicketRecord[]
  flagsByKey: Readonly<Record<string, TicketFlags>> | undefined
  onMoveTicket: (key: string, state: TicketState) => void
}): React.JSX.Element {
  const label = ticketStateLabel(state)
  const [dragOver, setDragOver] = useState(false)
  return (
    <section
      aria-label={label}
      data-ticket-state={state}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(TICKET_DRAG_TYPE)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        setDragOver(false)
        const key = event.dataTransfer.getData(TICKET_DRAG_TYPE)
        if (key) {
          event.preventDefault()
          onMoveTicket(key, state)
        }
      }}
      className={cn(
        'flex min-w-[240px] flex-1 flex-col rounded-xl border border-border/60 bg-muted/30',
        dragOver && 'border-ring bg-accent/40'
      )}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {label}
        </span>
        <span className="ml-auto rounded-full bg-background px-1.5 text-[11px] tabular-nums text-muted-foreground">
          {tickets.length}
        </span>
      </header>
      <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {tickets.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-muted-foreground">
            {translate('autosfactory.column.empty', 'None')}
          </p>
        ) : (
          tickets.map((ticket) => (
            <TicketCard
              key={ticket.key}
              ticket={ticket}
              flags={flagsByKey?.[ticket.key]}
              onMove={onMoveTicket}
            />
          ))
        )}
      </div>
    </section>
  )
}

export function TicketBoard({
  tickets,
  flagsByKey,
  onMoveTicket,
  containerClassName = 'h-full w-full'
}: TicketBoardProps): React.JSX.Element {
  const grouped = useMemo(() => groupTicketsByState(tickets), [tickets])
  return (
    <div className={cn('flex flex-col bg-background text-foreground', containerClassName)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="text-[13px] font-semibold">
          {translate('autosfactory.board.title', 'Tickets')}
        </h1>
        <span className="text-[11px] text-muted-foreground">
          {translate('autosfactory.board.total', '{{count}} total', { count: tickets.length })}
        </span>
      </div>
      <div className="scrollbar-sleek flex min-h-0 flex-1 overflow-x-auto p-3">
        <div className="flex w-full gap-3">
          {TICKET_STATES.map((state) => (
            <TicketColumn
              key={state}
              state={state}
              tickets={grouped[state]}
              flagsByKey={flagsByKey}
              onMoveTicket={onMoveTicket}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
