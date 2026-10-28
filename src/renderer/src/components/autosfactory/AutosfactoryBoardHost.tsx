import { KanbanSquare, XIcon } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAutosfactoryBoardOpenStore } from './autosfactory-board-open-store'
import { TicketBoard } from './TicketBoard'
import { useTicketBoard } from './use-ticket-board'

function OpenTicketBoard({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { tickets, error, moveTicket } = useTicketBoard()
  return (
    <div
      role="dialog"
      aria-label={translate('autosfactory.board.title', 'Tickets')}
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={translate('autosfactory.board.close', 'Close ticket board')}
        className="absolute right-3 top-2 z-10 rounded-sm p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <XIcon className="size-4" />
      </button>
      {error ? (
        <p role="alert" className="px-4 py-1 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
      <TicketBoard
        tickets={tickets}
        onMoveTicket={moveTicket}
        containerClassName="min-h-0 flex-1"
      />
    </div>
  )
}

/** App-root host: a corner button opens the full-window ticket board. */
export function AutosfactoryBoardHost(): React.JSX.Element {
  const open = useAutosfactoryBoardOpenStore((state) => state.open)
  const setOpen = useAutosfactoryBoardOpenStore((state) => state.setOpen)
  return open ? (
    <OpenTicketBoard onClose={() => setOpen(false)} />
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={translate('autosfactory.board.open', 'Open ticket board')}
      className="fixed bottom-8 right-3 z-40 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <KanbanSquare className="size-3.5" />
      {translate('autosfactory.board.title', 'Tickets')}
    </button>
  )
}
