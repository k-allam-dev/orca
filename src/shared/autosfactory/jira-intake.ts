export const JIRA_INTAKE_INTERVAL_MS = 30 * 60 * 1000

// Why: board project keys are guesses until confirmed; edit here to change what is imported.
export const JIRA_INTAKE_PROJECT_KEYS = ['SNPL', 'TECHOPS'] as const

export const JIRA_INTAKE_JQL = `assignee = currentUser() AND project in (${JIRA_INTAKE_PROJECT_KEYS.join(', ')}) AND statusCategory != Done ORDER BY updated DESC`

export const JIRA_ALERT_KINDS = ['status', 'assignee', 'summary', 'description'] as const
export type JiraAlertKind = (typeof JIRA_ALERT_KINDS)[number]

export type JiraAlert = {
  id: string
  key: string
  kind: JiraAlertKind
  oldValue: string | null
  newValue: string | null
  createdAt: string
}

export type JiraSyncStatus = {
  lastGoodSyncAt: string | null
  lastAttemptAt: string | null
  lastError: string | null
  tokenProblem: boolean
}

export type JiraSyncResult = { created: string[]; alertsAdded: number; status: JiraSyncStatus }
