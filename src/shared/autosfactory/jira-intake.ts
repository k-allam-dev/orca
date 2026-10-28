export const JIRA_INTAKE_INTERVAL_MS = 30 * 60 * 1000

// Why: Jira board ids Kareem gave (Jira boards are not projects); the sync reports an error when none are set.
export const JIRA_INTAKE_BOARD_IDS: readonly number[] = [637, 1106, 805]

// Why: the ticket's Jira project is arbitrary, so only the board and these statuses decide what is imported.
export const JIRA_INTAKE_STATUS_NAMES = [
  'Backlog',
  'Selected for Development',
  'To Do',
  'In Progress'
] as const

export const JIRA_INTAKE_JQL = `assignee = currentUser() AND status in (${JIRA_INTAKE_STATUS_NAMES.map((name) => `"${name}"`).join(', ')})`

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
