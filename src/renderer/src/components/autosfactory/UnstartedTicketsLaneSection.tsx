import { useMemo } from 'react'
import { useAllWorktrees } from '@/store/selectors'
import { useJiraAlertsForKey } from './jira-alert-store'
import { UnstartedTicketCard } from './UnstartedTicketCard'
import { selectUnstartedTickets } from './unstarted-tickets-model'
import { useUnstartedData } from './unstarted-tickets-store'

const NEW_COLUMN_STATUS_ID = 'todo'

function TicketWithAlerts({
  ticket,
  jiraStatus
}: {
  ticket: Parameters<typeof UnstartedTicketCard>[0]['ticket']
  jiraStatus: string | undefined
}): React.JSX.Element {
  const alerts = useJiraAlertsForKey(ticket.key)
  return <UnstartedTicketCard ticket={ticket} jiraStatus={jiraStatus} alerts={alerts} />
}

/** Shows Jira tickets that have no workspace yet as cards at the top of the New column. */
export function UnstartedTicketsLaneSection({
  statusId
}: {
  statusId: string
}): React.JSX.Element | null {
  const worktrees = useAllWorktrees()
  const data = useUnstartedData()
  const unstarted = useMemo(
    () => selectUnstartedTickets([...data.tickets], worktrees),
    [data.tickets, worktrees]
  )
  if (statusId !== NEW_COLUMN_STATUS_ID || unstarted.length === 0) {
    return null
  }
  return (
    <div data-autosfactory-unstarted-lane="">
      {unstarted.map((ticket) => (
        <TicketWithAlerts key={ticket.key} ticket={ticket} jiraStatus={data.statuses[ticket.key]} />
      ))}
    </div>
  )
}
