import { KanbanSquare, XIcon } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAutosfactoryBoardOpenStore } from './autosfactory-board-open-store'
import { TicketBoard } from './TicketBoard'
import { useTicketBoard } from './use-ticket-board'
import { activeWorktreePath, openWorktreeTerminalByPath } from './ticket-workspace-link'
import type { TicketRecord } from '../../../../shared/autosfactory/ticket-state'

function OpenTicketBoard({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { tickets, error, moveTicket, createTicket, linkWorktree } = useTicketBoard()
  const openTicket = (ticket: TicketRecord): void => {
    // Why: until the runner (step 9) creates a workspace per ticket, a ticket opens the workspace it is linked to; the first click links the workspace you were in.
    const linked = ticket.worktreePath ?? activeWorktreePath()
    if (!linked) {
      return
    }
    if (!ticket.worktreePath) {
      void linkWorktree(ticket.key, linked)
    }
    if (openWorktreeTerminalByPath(linked)) {
      onClose()
    }
  }
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
        onOpenTicket={openTicket}
        onCreateTicket={(key, title) => void createTicket(key, title)}
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
      className="fixed bottom-10 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <KanbanSquare className="size-4" />
      {translate('autosfactory.board.title', 'Tickets')}
    </button>
  )
}
