import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'
import {
  JIRA_INTAKE_BOARD_IDS,
  JIRA_INTAKE_JQL,
  type JiraAlert,
  type JiraSyncResult,
  type JiraSyncStatus
} from '../../shared/autosfactory/jira-intake'
import { isTicketKey } from '../../shared/autosfactory/ticket-state'

export type JiraIntakeIssue = {
  key: string
  title: string
  statusName: string
  assigneeName: string | null
  updatedAt: string
}

// Why: this is the only door to Jira for intake, and it has no write operations by design.
export type JiraReadClient = {
  isConnected: () => boolean
  isTokenProblem: (error: unknown) => boolean
  listBoardIssues: (boardId: number, jql: string) => Promise<JiraIntakeIssue[]>
  getDescription: (key: string) => Promise<string>
}

export type JiraIntakeTicketStore = {
  get: (key: string) => unknown
  create: (input: { key: string; title: string }) => Promise<unknown>
}

type Snapshot = {
  status: string
  assignee: string | null
  summary: string
  descriptionHash: string
  updatedAt: string
}

type IntakeFile = {
  version: 1
  snapshots: Record<string, Snapshot>
  alerts: JiraAlert[]
  status: JiraSyncStatus
}

const EMPTY_STATUS: JiraSyncStatus = {
  lastGoodSyncAt: null,
  lastAttemptAt: null,
  lastError: null,
  tokenProblem: false
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function emptyData(): IntakeFile {
  return { version: 1, snapshots: {}, alerts: [], status: EMPTY_STATUS }
}

export class JiraIntake {
  private data: IntakeFile = emptyData()
  private running: Promise<JiraSyncResult> | null = null

  constructor(
    private readonly filePath: string,
    private readonly tickets: JiraIntakeTicketStore,
    private readonly jira: JiraReadClient,
    private readonly jql: string = JIRA_INTAKE_JQL,
    private readonly boardIds: readonly number[] = JIRA_INTAKE_BOARD_IDS,
    private readonly now: () => Date = () => new Date()
  ) {}

  async load(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf-8'))
      const fields = Object.fromEntries(
        Object.entries(typeof parsed === 'object' && parsed !== null ? parsed : {})
      )
      this.data = {
        version: 1,
        snapshots:
          typeof fields.snapshots === 'object' && fields.snapshots !== null
            ? { ...fields.snapshots }
            : {},
        alerts: Array.isArray(fields.alerts) ? fields.alerts : [],
        status:
          typeof fields.status === 'object' && fields.status !== null
            ? { ...EMPTY_STATUS, ...fields.status }
            : EMPTY_STATUS
      }
    } catch {
      this.data = emptyData()
    }
  }

  getStatus(): JiraSyncStatus {
    return this.data.status
  }

  listJiraStatuses(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.data.snapshots).map(([key, snapshot]) => [key, snapshot.status])
    )
  }

  listAlerts(): JiraAlert[] {
    return [...this.data.alerts]
  }

  async dismissAlert(id: string): Promise<void> {
    this.data = { ...this.data, alerts: this.data.alerts.filter((alert) => alert.id !== id) }
    await this.persist()
  }

  syncNow(): Promise<JiraSyncResult> {
    this.running ??= this.runSync().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async runSync(): Promise<JiraSyncResult> {
    const attemptedAt = this.now().toISOString()
    try {
      if (!this.jira.isConnected()) {
        throw new Error('Jira is not connected. Connect Jira with an API token.')
      }
      const { issues, problems } = await this.fetchBoards()
      const result = await this.apply(issues)
      this.data = {
        ...this.data,
        status: {
          lastGoodSyncAt: problems.length === 0 ? attemptedAt : this.data.status.lastGoodSyncAt,
          lastAttemptAt: attemptedAt,
          lastError: problems.length === 0 ? null : problems.join(' '),
          tokenProblem: false
        }
      }
      await this.persist()
      return { ...result, status: this.data.status }
    } catch (error) {
      this.data = {
        ...this.data,
        status: {
          ...this.data.status,
          lastAttemptAt: attemptedAt,
          lastError: error instanceof Error ? error.message : String(error),
          tokenProblem: !this.jira.isConnected() || this.jira.isTokenProblem(error)
        }
      }
      await this.persist()
      return { created: [], alertsAdded: 0, status: this.data.status }
    }
  }

  // Why: one failing board must not hide the other board's tickets.
  private async fetchBoards(): Promise<{ issues: JiraIntakeIssue[]; problems: string[] }> {
    if (this.boardIds.length === 0) {
      throw new Error('No Jira board ids configured.')
    }
    const byKey = new Map<string, JiraIntakeIssue>()
    const problems: string[] = []
    for (const boardId of this.boardIds) {
      try {
        for (const issue of await this.jira.listBoardIssues(boardId, this.jql)) {
          byKey.set(issue.key, issue)
        }
      } catch (error) {
        if (this.jira.isTokenProblem(error)) {
          throw error
        }
        problems.push(`Board ${boardId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (problems.length === this.boardIds.length) {
      throw new Error(problems.join(' '))
    }
    return { issues: [...byKey.values()], problems }
  }

  private async apply(
    issues: JiraIntakeIssue[]
  ): Promise<{ created: string[]; alertsAdded: number }> {
    const created: string[] = []
    const alerts: JiraAlert[] = []
    const snapshots = { ...this.data.snapshots }
    for (const issue of issues) {
      if (!isTicketKey(issue.key)) {
        continue
      }
      const previous = snapshots[issue.key]
      if (!this.tickets.get(issue.key)) {
        await this.tickets.create({ key: issue.key, title: issue.title })
        created.push(issue.key)
      }
      if (previous && previous.updatedAt === issue.updatedAt) {
        continue
      }
      const next: Snapshot = {
        status: issue.statusName,
        assignee: issue.assigneeName,
        summary: issue.title,
        descriptionHash: hashText(await this.jira.getDescription(issue.key)),
        updatedAt: issue.updatedAt
      }
      if (previous) {
        alerts.push(...this.diff(issue.key, previous, next))
      }
      snapshots[issue.key] = next
    }
    this.data = { ...this.data, snapshots, alerts: [...this.data.alerts, ...alerts] }
    return { created, alertsAdded: alerts.length }
  }

  private diff(key: string, before: Snapshot, after: Snapshot): JiraAlert[] {
    const createdAt = this.now().toISOString()
    const make = (
      kind: JiraAlert['kind'],
      oldValue: string | null,
      newValue: string | null
    ): JiraAlert => ({ id: randomUUID(), key, kind, oldValue, newValue, createdAt })
    const found: JiraAlert[] = []
    if (before.status !== after.status) {
      found.push(make('status', before.status, after.status))
    }
    if (before.assignee !== after.assignee) {
      found.push(make('assignee', before.assignee, after.assignee))
    }
    if (before.summary !== after.summary) {
      found.push(make('summary', before.summary, after.summary))
    }
    if (before.descriptionHash !== after.descriptionHash) {
      found.push(make('description', null, null))
    }
    return found
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFileDurable(
      durableWriteTempPath(this.filePath),
      this.filePath,
      `${JSON.stringify(this.data, null, 2)}\n`
    )
  }
}
