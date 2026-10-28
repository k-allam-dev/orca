import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { useAllWorktrees } from '@/store/selectors'
import { getSettingsFocusedExecutionHostId } from '../../../../shared/execution-host'
import { normalizeTaskSourceContext } from '../../../../shared/task-source-context'
import type { JiraAlert, JiraSyncStatus } from '../../../../shared/autosfactory/jira-intake'
import type { TicketRecord } from '../../../../shared/autosfactory/ticket-state'
import { bindTaskPageJiraItemSourceContext } from '../task-page-jira-item-source-context'
import { getJiraIssueWorkspaceSeed, getTaskPageRepoSourceContext } from '../task-page-source-context'
import { getRepoWorkspaceCreationTargetHint } from '@/lib/project-host-workspace-target'
import { selectUnstartedTickets, syncBannerFor } from './unstarted-tickets-model'

const REFRESH_INTERVAL_MS = 10_000

type PanelData = {
  tickets: TicketRecord[]
  alerts: JiraAlert[]
  statuses: Record<string, string>
  sync: JiraSyncStatus | null
}

const EMPTY: PanelData = { tickets: [], alerts: [], statuses: {}, sync: null }

function alertText(alert: JiraAlert): string {
  if (alert.kind === 'status' || alert.kind === 'assignee') {
    return `Jira changed ${alert.kind}: ${alert.oldValue ?? 'none'} to ${alert.newValue ?? 'none'}`
  }
  return `Jira changed the ${alert.kind}`
}

export function UnstartedTicketsPanel(): React.JSX.Element | null {
  const worktrees = useAllWorktrees()
  const repos = useAppStore((s) => s.repos)
  const openModal = useAppStore((s) => s.openModal)
  const [data, setData] = useState<PanelData>(EMPTY)
  const [syncing, setSyncing] = useState(false)
  const [open, setOpen] = useState(true)

  const refresh = useCallback(async (): Promise<void> => {
    const api = window.api.autosfactory
    const [tickets, alerts, statuses, sync] = await Promise.all([
      api.listTickets(),
      api.listAlerts(),
      api.listJiraStatuses(),
      api.getSyncStatus()
    ])
    setData({ tickets, alerts, statuses, sync })
  }, [])

  useEffect(() => {
    void refresh().catch(() => {})
    const timer = setInterval(() => void refresh().catch(() => {}), REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const unstarted = useMemo(
    () => selectUnstartedTickets(data.tickets, worktrees),
    [data.tickets, worktrees]
  )
  const banner = syncBannerFor(data.sync)

  const syncNow = async (): Promise<void> => {
    setSyncing(true)
    try {
      await window.api.autosfactory.syncNow()
      await refresh()
    } finally {
      setSyncing(false)
    }
  }

  const chooseRepo = async (key: string, repoId: string): Promise<void> => {
    await window.api.autosfactory.updateTicket({ key, patch: { repoId: repoId || null } })
    await refresh()
  }

  const dismiss = async (id: string): Promise<void> => {
    await window.api.autosfactory.dismissAlert({ id })
    await refresh()
  }

  const start = async (ticket: TicketRecord): Promise<void> => {
    const repo = repos.find((candidate) => candidate.id === ticket.repoId)
    const issue = await window.api.jira.getIssue({ key: ticket.key })
    const jiraStatus = await window.api.jira.status()
    const baseContext = normalizeTaskSourceContext({
      provider: 'jira',
      projectId:
        getTaskPageRepoSourceContext(repo, 'github')?.projectId ?? 'account-backed-task-source',
      hostId: getSettingsFocusedExecutionHostId(useAppStore.getState().settings)
    })
    const taskSourceContext = issue
      ? bindTaskPageJiraItemSourceContext({
          issue,
          sites: jiraStatus.sites ?? [],
          sourceContext: baseContext
        })
      : null
    if (!repo || !issue || !taskSourceContext) {
      toast.error(`Could not start ${ticket.key}. Check the Jira connection and the project.`)
      return
    }
    openModal('new-workspace-composer', {
      linkedWorkItem: {
        type: 'issue',
        provider: 'jira',
        number: 0,
        title: `${issue.key} ${issue.title}`,
        url: issue.url,
        jiraIdentifier: issue.key
      },
      taskSourceContext,
      initialRepoId: repo.id,
      initialWorkspaceTarget: getRepoWorkspaceCreationTargetHint(
        repo,
        useAppStore.getState().projectHostSetups
      ),
      prefilledName: getJiraIssueWorkspaceSeed(issue),
      telemetrySource: 'sidebar'
    })
  }

  return (
    <div className="shrink-0 border-b border-border text-sm" data-autosfactory-unstarted-panel="">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          className="font-medium"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          Unstarted tickets ({unstarted.length})
        </button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={syncing}
          onClick={() => void syncNow()}
        >
          {syncing ? 'Syncing...' : 'Sync now'}
        </Button>
      </div>
      {banner.kind !== 'none' ? (
        <div role="alert" className="mx-3 mb-2 rounded-md border border-border bg-muted px-2 py-1">
          <div>
            {banner.kind === 'not-connected'
              ? 'Jira is not connected. Connect Jira in Settings.'
              : banner.kind === 'token'
                ? `Jira token problem: ${banner.message}`
                : `Jira sync failed: ${banner.message}`}
          </div>
          <div className="text-muted-foreground">
            {banner.lastGoodSyncAt
              ? `Showing tickets from the last good sync at ${new Date(banner.lastGoodSyncAt).toLocaleString()}.`
              : 'No successful sync yet.'}
          </div>
        </div>
      ) : null}
      {open ? (
        <ul className="max-h-64 space-y-2 overflow-y-auto px-3 pb-2">
          {unstarted.length === 0 ? (
            <li className="text-muted-foreground">No unstarted tickets.</li>
          ) : null}
          {unstarted.map((ticket) => (
            <li key={ticket.key} className="rounded-md border border-border p-2">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{ticket.key}</span>
                <span className="truncate">{ticket.title}</span>
                {data.statuses[ticket.key] ? (
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {data.statuses[ticket.key]}
                  </span>
                ) : null}
              </div>
              {data.alerts
                .filter((alert) => alert.key === ticket.key)
                .map((alert) => (
                  <div key={alert.id} className="mt-1 flex items-center gap-2 text-amber-600">
                    <span>{alertText(alert)}</span>
                    <Button size="sm" variant="ghost" onClick={() => void dismiss(alert.id)}>
                      Dismiss
                    </Button>
                  </div>
                ))}
              <div className="mt-1 flex items-center gap-2">
                <select
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-1 py-1"
                  aria-label={`Project for ${ticket.key}`}
                  value={ticket.repoId ?? ''}
                  onChange={(event) => void chooseRepo(ticket.key, event.target.value)}
                >
                  <option value="">Choose a project</option>
                  {repos.map((repo) => (
                    <option key={repo.id} value={repo.id}>
                      {repo.displayName}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!ticket.repoId || !repos.some((repo) => repo.id === ticket.repoId)}
                  onClick={() => void start(ticket)}
                >
                  Start
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
