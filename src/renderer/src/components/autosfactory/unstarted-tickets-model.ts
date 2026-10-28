import type { TicketRecord } from '../../../../shared/autosfactory/ticket-state'
import type { JiraSyncStatus } from '../../../../shared/autosfactory/jira-intake'

type WorktreeLink = {
  linkedWorkItem?: { provider?: string; jiraIdentifier?: string } | null
}

export function selectUnstartedTickets(
  tickets: readonly TicketRecord[],
  worktrees: readonly WorktreeLink[]
): TicketRecord[] {
  const linkedKeys = new Set(
    worktrees.flatMap((worktree) =>
      worktree.linkedWorkItem?.provider === 'jira' && worktree.linkedWorkItem.jiraIdentifier
        ? [worktree.linkedWorkItem.jiraIdentifier]
        : []
    )
  )
  return tickets.filter(
    (ticket) => ticket.state === 'new' && !ticket.worktreePath && !linkedKeys.has(ticket.key)
  )
}

export type SyncBanner =
  | { kind: 'none' }
  | { kind: 'not-connected' | 'token' | 'error'; message: string; lastGoodSyncAt: string | null }

export function syncBannerFor(status: JiraSyncStatus | null): SyncBanner {
  if (!status || (!status.lastError && !status.tokenProblem)) {
    return { kind: 'none' }
  }
  const message = status.lastError ?? 'Jira token problem.'
  const kind = status.tokenProblem
    ? message.toLowerCase().includes('not connected')
      ? 'not-connected'
      : 'token'
    : 'error'
  return { kind, message, lastGoodSyncAt: status.lastGoodSyncAt }
}
