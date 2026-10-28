import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'
import {
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
  searchIssues: (jql: string) => Promise<JiraIntakeIssue[]>
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
      const issues = await this.jira.searchIssues(this.jql)
      const result = await this.apply(issues)
      this.data = {
        ...this.data,
        status: {
          lastGoodSyncAt: attemptedAt,
          lastAttemptAt: attemptedAt,
          lastError: null,
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
