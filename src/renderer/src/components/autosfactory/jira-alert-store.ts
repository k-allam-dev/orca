import { useSyncExternalStore } from 'react'
import type { JiraAlert } from '../../../../shared/autosfactory/jira-intake'

const POLL_INTERVAL_MS = 15_000
const NO_ALERTS: readonly JiraAlert[] = []

let alerts: readonly JiraAlert[] = NO_ALERTS
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

export async function refreshJiraAlerts(): Promise<void> {
  try {
    alerts = await window.api.autosfactory.listAlerts()
    listeners.forEach((listener) => listener())
  } catch {
    // Why: a failed read keeps the last alerts on screen.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refreshJiraAlerts()
    timer = setInterval(() => void refreshJiraAlerts(), POLL_INTERVAL_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function useJiraAlertsForKey(key: string | undefined): readonly JiraAlert[] {
  const all = useSyncExternalStore(subscribe, () => alerts)
  return key ? all.filter((alert) => alert.key === key) : NO_ALERTS
}
