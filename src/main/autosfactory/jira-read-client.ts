import { getStatus, isAuthError } from '../jira/client'
import { getIssue, searchIssues } from '../jira/issues'
import type { JiraReadClient } from './jira-intake'

const INTAKE_ISSUE_LIMIT = 100

export const orcaJiraReadClient: JiraReadClient = {
  isConnected: () => getStatus().connected,
  isTokenProblem: (error) => isAuthError(error) || Boolean(getStatus().credentialError),
  searchIssues: async (jql) =>
    (await searchIssues(jql, INTAKE_ISSUE_LIMIT, undefined, undefined, true)).map((issue) => ({
      key: issue.key,
      title: issue.title,
      statusName: issue.status.name,
      assigneeName: issue.assignee?.displayName ?? null,
      updatedAt: issue.updatedAt
    })),
  getDescription: async (key) => (await getIssue(key, undefined, true))?.description ?? ''
}
