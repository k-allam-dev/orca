import { getClients, getStatus, isAuthError } from '../jira/client'
import { jiraRequest, type JiraClientForSite } from '../jira/authenticated-request'
import { ISSUE_LIST_FIELDS, mapJiraIssue } from '../jira/jira-issue-mapping'
import { getIssue } from '../jira/issues'
import type { JiraIssue } from '../../shared/jira/jira-types'
import { isRecord, type JiraReadClient } from './jira-intake'

const BOARD_PAGE_SIZE = 50
const BOARD_PAGE_LIMIT = 20

type AgileRecord = Record<string, unknown>

function connectedClient(): JiraClientForSite {
  const [client] = getClients()
  if (!client) {
    throw new Error('Jira is not connected.')
  }
  return client
}

// Why: GET is the only HTTP method this file may use, so Jira can never be changed from intake.
async function agileGet(client: JiraClientForSite, path: string): Promise<AgileRecord> {
  const result = await jiraRequest<unknown>(client, path, { method: 'GET' })
  return isRecord(result) ? result : {}
}

export const orcaJiraReadClient: JiraReadClient = {
  isConnected: () => getStatus().connected,
  isTokenProblem: (error) => isAuthError(error) || Boolean(getStatus().credentialError),
  listBoardIssues: async (boardId, jql) => {
    const client = connectedClient()
    const issues: JiraIssue[] = []
    for (let page = 0; page < BOARD_PAGE_LIMIT; page += 1) {
      const query = new URLSearchParams({
        jql,
        startAt: String(page * BOARD_PAGE_SIZE),
        maxResults: String(BOARD_PAGE_SIZE),
        fields: ISSUE_LIST_FIELDS.join(',')
      })
      const result = await agileGet(client, `/rest/agile/1.0/board/${boardId}/issue?${query}`)
      const records = Array.isArray(result.issues) ? result.issues.filter(isRecord) : []
      issues.push(...records.map((record) => mapJiraIssue(client.site, record)))
      if (records.length < BOARD_PAGE_SIZE) {
        break
      }
    }
    return issues.map((issue) => ({
      key: issue.key,
      title: issue.title,
      statusName: issue.status.name,
      assigneeName: issue.assignee?.displayName ?? null,
      updatedAt: issue.updatedAt
    }))
  },
  getDescription: async (key) => (await getIssue(key, undefined, true))?.description ?? ''
}
