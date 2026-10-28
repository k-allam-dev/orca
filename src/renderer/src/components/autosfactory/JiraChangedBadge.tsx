import type { Worktree } from '../../../../shared/worktree/types'
import { useJiraAlertsForKey } from './jira-alert-store'

export function JiraChangedBadge({ worktree }: { worktree: Worktree }): React.JSX.Element | null {
  const item = worktree.linkedWorkItem
  const key = item?.provider === 'jira' ? item.jiraIdentifier : undefined
  const alerts = useJiraAlertsForKey(key)
  if (alerts.length === 0) {
    return null
  }
  return (
    <span
      className="pointer-events-none absolute right-8 top-1.5 z-10 rounded-full bg-amber-500/90 px-1.5 text-[10px] font-medium text-white"
      title={alerts.map((alert) => alert.kind).join(', ')}
    >
      Jira changed
    </span>
  )
}
