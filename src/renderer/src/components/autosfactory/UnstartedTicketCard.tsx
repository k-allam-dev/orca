import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import type { JiraAlert } from '../../../../shared/autosfactory/jira-intake'
import type { TicketRecord } from '../../../../shared/autosfactory/ticket-state'
import { chooseTicketRepo, startTicket } from './unstarted-ticket-actions'
import { refreshJiraAlerts } from './jira-alert-store'
import { refreshUnstartedData } from './unstarted-tickets-store'

function alertText(alert: JiraAlert): string {
  if (alert.kind === 'status' || alert.kind === 'assignee') {
    return `Jira changed ${alert.kind}: ${alert.oldValue ?? 'none'} to ${alert.newValue ?? 'none'}`
  }
  return `Jira changed the ${alert.kind}`
}

type UnstartedTicketCardProps = {
  ticket: TicketRecord
  jiraStatus: string | undefined
  alerts: readonly JiraAlert[]
}

export function UnstartedTicketCard({
  ticket,
  jiraStatus,
  alerts
}: UnstartedTicketCardProps): React.JSX.Element {
  const repos = useAppStore((s) => s.repos)
  const repoChosen = repos.some((repo) => repo.id === ticket.repoId)
  const dismiss = async (id: string): Promise<void> => {
    await window.api.autosfactory.dismissAlert({ id })
    await refreshUnstartedData()
    await refreshJiraAlerts()
  }
  return (
    <div
      data-autosfactory-unstarted-card=""
      className="mb-2 rounded-md border border-dashed border-worktree-sidebar-border bg-background/60 p-2 text-[11px]"
    >
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{ticket.key}</span>
        {jiraStatus ? (
          <span className="ml-auto shrink-0 text-muted-foreground">{jiraStatus}</span>
        ) : null}
      </div>
      <div className="mt-0.5 line-clamp-2 text-foreground/90">{ticket.title}</div>
      {alerts.map((alert) => (
        <div key={alert.id} className="mt-1 flex items-center gap-1 text-amber-600">
          <span className="min-w-0 flex-1">{alertText(alert)}</span>
          <Button size="xs" variant="ghost" onClick={() => void dismiss(alert.id)}>
            Dismiss
          </Button>
        </div>
      ))}
      <div className="mt-1.5 flex items-center gap-1.5">
        <select
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-1 py-1"
          aria-label={`Project for ${ticket.key}`}
          value={ticket.repoId ?? ''}
          onChange={(event) => void chooseTicketRepo(ticket.key, event.target.value)}
        >
          <option value="">Choose a project</option>
          {repos.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.displayName}
            </option>
          ))}
        </select>
        <Button size="xs" disabled={!repoChosen} onClick={() => void startTicket(ticket)}>
          Start
        </Button>
      </div>
    </div>
  )
}
