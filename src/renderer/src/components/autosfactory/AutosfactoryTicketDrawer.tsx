import React, { useRef } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import WorkspaceKanbanSheet from '../sidebar/WorkspaceKanbanSheet'
import { useWorkspaceKanbanDrawerLingering } from '../sidebar/use-workspace-kanban-drawer-lingering'
import type { TicketRecord } from '../../../../shared/autosfactory/ticket-state'
import { TicketBoard } from './TicketBoard'
import { activeWorktreePath, openWorktreeTerminalByPath } from './ticket-workspace-link'
import { useTicketBoard } from './use-ticket-board'

type AutosfactoryTicketDrawerProps = {
  leftSidebarStyle?: React.CSSProperties
  open: boolean
  statusBarVisible: boolean
  dragPreview: boolean
  preserveOpenForMenu: boolean
  onOpenChange: (open: boolean) => void
  onMenuOpenChange?: (open: boolean) => void
}

function TicketDrawerContent({
  leftSidebarStyle,
  open,
  statusBarVisible,
  dragPreview,
  preserveOpenForMenu,
  onOpenChange
}: AutosfactoryTicketDrawerProps): React.JSX.Element {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const boardRef = useRef<HTMLDivElement>(null)
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
      onOpenChange(false)
    }
  }

  return (
    <WorkspaceKanbanSheet
      boardRef={boardRef}
      dragPreview={dragPreview}
      leftSidebarStyle={leftSidebarStyle}
      onOpenChange={onOpenChange}
      open={open}
      preserveOpenForMenu={preserveOpenForMenu}
      sidebarOpen={sidebarOpen}
      sidebarWidth={sidebarWidth}
      statusBarVisible={statusBarVisible}
    >
      <div ref={boardRef} className="flex min-h-0 flex-1 flex-col">
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
    </WorkspaceKanbanSheet>
  )
}

/** Replaces Orca's workspace board drawer: same sidebar toggle, our ticket board inside. */
export function AutosfactoryTicketDrawer(
  props: AutosfactoryTicketDrawerProps
): React.JSX.Element | null {
  const lingering = useWorkspaceKanbanDrawerLingering(props.open)
  if (!props.open && !lingering) {
    return null
  }
  return (
    <div aria-label={translate('autosfactory.board.title', 'Tickets')}>
      <TicketDrawerContent {...props} />
    </div>
  )
}
