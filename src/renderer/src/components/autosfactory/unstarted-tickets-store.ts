import { useSyncExternalStore } from 'react'
import type { JiraSyncStatus } from '../../../../shared/autosfactory/jira-intake'
import type { TicketRecord } from '../../../../shared/autosfactory/ticket-state'

const POLL_INTERVAL_MS = 10_000

export type UnstartedData = {
  tickets: readonly TicketRecord[]
  statuses: Readonly<Record<string, string>>
  sync: JiraSyncStatus | null
}

const EMPTY: UnstartedData = { tickets: [], statuses: {}, sync: null }

let data = EMPTY
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

export async function refreshUnstartedData(): Promise<void> {
  try {
    const api = window.api.autosfactory
    const [tickets, statuses, sync] = await Promise.all([
      api.listTickets(),
      api.listJiraStatuses(),
      api.getSyncStatus()
    ])
    data = { tickets, statuses, sync }
    listeners.forEach((listener) => listener())
  } catch {
    // Why: a failed read keeps the last data on screen.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refreshUnstartedData()
    timer = setInterval(() => void refreshUnstartedData(), POLL_INTERVAL_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function useUnstartedData(): UnstartedData {
  return useSyncExternalStore(subscribe, () => data)
}
