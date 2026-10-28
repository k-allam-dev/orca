import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { getSettingsFocusedExecutionHostId } from '../../../../shared/execution-host'
import { normalizeTaskSourceContext } from '../../../../shared/task-source-context'
import type { TicketRecord } from '../../../../shared/autosfactory/ticket-state'
import { bindTaskPageJiraItemSourceContext } from '../task-page-jira-item-source-context'
import {
  getJiraIssueWorkspaceSeed,
  getTaskPageRepoSourceContext
} from '../task-page-source-context'
import { getRepoWorkspaceCreationTargetHint } from '@/lib/project-host-workspace-target'
import { refreshUnstartedData } from './unstarted-tickets-store'

export async function chooseTicketRepo(key: string, repoId: string): Promise<void> {
  await window.api.autosfactory.updateTicket({ key, patch: { repoId: repoId || null } })
  await refreshUnstartedData()
}

export async function startTicket(ticket: TicketRecord): Promise<void> {
  const state = useAppStore.getState()
  const repo = state.repos.find((candidate) => candidate.id === ticket.repoId)
  const issue = await window.api.jira.getIssue({ key: ticket.key })
  const jiraStatus = await window.api.jira.status()
  const baseContext = normalizeTaskSourceContext({
    provider: 'jira',
    projectId:
      getTaskPageRepoSourceContext(repo, 'github')?.projectId ?? 'account-backed-task-source',
    hostId: getSettingsFocusedExecutionHostId(state.settings)
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
  state.openModal('new-workspace-composer', {
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
    initialWorkspaceTarget: getRepoWorkspaceCreationTargetHint(repo, state.projectHostSetups),
    prefilledName: getJiraIssueWorkspaceSeed(issue),
    telemetrySource: 'sidebar'
  })
}
