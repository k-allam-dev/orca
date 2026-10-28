import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { useAllWorktrees } from '@/store/selectors'
import type { TicketState } from '../../../../shared/autosfactory/ticket-state'
import {
  TICKET_STATE_COLUMNS,
  isLegacyDefaultColumns,
  statusForTicketState,
  ticketStateForStatus
} from './ticket-status-columns'

const SYNC_INTERVAL_MS = 3000

/** Keeps tickets and Orca's workspace board in step: a workspace linked to a Jira issue is that ticket, and its board column is the ticket's state. */
export function AutosfactorySync(): null {
  const worktrees = useAllWorktrees()
  const statuses = useAppStore((s) => s.workspaceStatuses)
  const setStatuses = useAppStore((s) => s.setWorkspaceStatuses)
  const worktreesRef = useRef(worktrees)
  worktreesRef.current = worktrees
  const lastSynced = useRef(new Map<string, TicketState>())

  useEffect(() => {
    if (isLegacyDefaultColumns(statuses)) {
      setStatuses(TICKET_STATE_COLUMNS)
    }
  }, [statuses, setStatuses])

  useEffect(() => {
    let stopped = false
    let running = false

    async function syncOnce(): Promise<void> {
      const api = window.api.autosfactory
      const tickets = await api.listTickets()
      const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]))
      for (const worktree of worktreesRef.current) {
        const item = worktree.linkedWorkItem
        const key = item?.provider === 'jira' ? item.jiraIdentifier : undefined
        if (!item || !key || stopped) {
          continue
        }
        try {
          const workspaceState = ticketStateForStatus(worktree.workspaceStatus)
          let ticket = byKey.get(key)
          if (!ticket) {
            ticket = await api.createTicket({ key, title: item.title })
            ticket = await api.updateTicket({ key, patch: { worktreePath: worktree.path } })
            if (workspaceState !== 'new') {
              ticket = await api.moveTicket({ key, state: workspaceState })
            }
            lastSynced.current.set(key, ticket.state)
            continue
          }
          if (ticket.worktreePath !== worktree.path) {
            ticket = await api.updateTicket({ key, patch: { worktreePath: worktree.path } })
          }
          const last = lastSynced.current.get(key)
          if (last === undefined) {
            // Why: the saved ticket is the record of truth the first time we see a pair.
            if (workspaceState !== ticket.state) {
              await useAppStore.getState().updateWorktreeMeta(worktree.id, {
                workspaceStatus: statusForTicketState(ticket.state)
              })
            }
            lastSynced.current.set(key, ticket.state)
          } else if (workspaceState !== last) {
            await api.moveTicket({ key, state: workspaceState })
            lastSynced.current.set(key, workspaceState)
          } else if (ticket.state !== last) {
            await useAppStore.getState().updateWorktreeMeta(worktree.id, {
              workspaceStatus: statusForTicketState(ticket.state)
            })
            lastSynced.current.set(key, ticket.state)
          }
        } catch (error) {
          console.error('[autosfactory] ticket sync failed for', key, error)
        }
      }
    }

    async function tick(): Promise<void> {
      if (running || stopped) {
        return
      }
      running = true
      try {
        await syncOnce()
      } catch (error) {
        console.error('[autosfactory] ticket sync failed', error)
      } finally {
        running = false
      }
    }

    void tick()
    const timer = setInterval(() => void tick(), SYNC_INTERVAL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])

  return null
}
