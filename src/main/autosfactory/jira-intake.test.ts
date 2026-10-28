import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ticketFlagsFromJiraAlerts } from '../../shared/autosfactory/ticket-flags'
import { JIRA_INTAKE_JQL } from '../../shared/autosfactory/jira-intake'
import { JiraIntake, type JiraIntakeIssue, type JiraReadClient } from './jira-intake'
import { TicketStateStore } from './ticket-state-store'

type FakeJira = JiraReadClient & {
  issues: JiraIntakeIssue[]
  descriptions: Record<string, string>
  connected: boolean
  failure: Error | null
  calls: string[]
}

function makeFakeJira(): FakeJira {
  const fake: FakeJira = {
    issues: [],
    descriptions: {},
    connected: true,
    failure: null,
    calls: [],
    isConnected: () => fake.connected,
    isTokenProblem: (error) => error instanceof Error && error.message === 'token expired',
    listBoardIssues: async (boardId, jql) => {
      fake.calls.push(`search:${boardId}:${jql}`)
      if (fake.failure) {
        throw fake.failure
      }
      return boardId === 1 ? fake.issues : []
    },
    getDescription: async (key) => {
      fake.calls.push(`description:${key}`)
      return fake.descriptions[key] ?? ''
    }
  }
  return fake
}

function issue(overrides: Partial<JiraIntakeIssue> = {}): JiraIntakeIssue {
  return {
    key: 'SNPL-1',
    title: 'Fix header',
    statusName: 'To Do',
    assigneeName: 'Kareem',
    updatedAt: '2026-10-28T10:00:00.000Z',
    ...overrides
  }
}

describe('JiraIntake', () => {
  let directory: string
  let tickets: TicketStateStore
  let jira: FakeJira

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'autosfactory-intake-'))
    tickets = new TicketStateStore(join(directory, 'tickets'))
    await tickets.load()
    jira = makeFakeJira()
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  async function openIntake(boardIds: readonly number[] = [1, 2]): Promise<JiraIntake> {
    const intake = new JiraIntake(join(directory, 'jira-intake.json'), tickets, jira, 'JQL', boardIds)
    await intake.load()
    return intake
  }

  it('creates a new ticket in state new and sends the configured JQL', async () => {
    jira.issues = [issue()]
    const intake = await openIntake()
    const result = await intake.syncNow()
    expect(result.created).toEqual(['SNPL-1'])
    expect(tickets.get('SNPL-1')).toMatchObject({ state: 'new', title: 'Fix header' })
    expect(jira.calls).toContain('search:1:JQL')
    expect(jira.calls).toContain('search:2:JQL')
    expect(intake.getStatus().lastGoodSyncAt).not.toBeNull()
  })

  it('records a clear error and does not crash when no board ids are configured', async () => {
    const intake = await openIntake([])
    const result = await intake.syncNow()
    expect(result.status.lastError).toBe('No Jira board ids configured.')
    expect(result.status.tokenProblem).toBe(false)
    expect(jira.calls).toEqual([])
  })

  it('imports only the configured statuses', () => {
    expect(JIRA_INTAKE_JQL).toContain('"Backlog", "Selected for Development", "To Do", "In Progress"')
    expect(JIRA_INTAKE_JQL).not.toContain('project')
  })

  it('skips issues whose key fails validation', async () => {
    jira.issues = [issue({ key: 'bad key' })]
    const intake = await openIntake()
    expect((await intake.syncNow()).created).toEqual([])
  })

  it('does nothing on an unchanged resync', async () => {
    jira.issues = [issue()]
    const intake = await openIntake()
    await intake.syncNow()
    const second = await intake.syncNow()
    expect(second.created).toEqual([])
    expect(second.alertsAdded).toBe(0)
    expect(intake.listAlerts()).toEqual([])
    expect(jira.calls.filter((call) => call === 'description:SNPL-1')).toHaveLength(1)
  })

  it('records a status change alert with old and new values', async () => {
    jira.issues = [issue()]
    const intake = await openIntake()
    await intake.syncNow()
    jira.issues = [issue({ statusName: 'In Progress', updatedAt: '2026-10-28T11:00:00.000Z' })]
    await intake.syncNow()
    expect(intake.listAlerts()).toMatchObject([
      { key: 'SNPL-1', kind: 'status', oldValue: 'To Do', newValue: 'In Progress' }
    ])
    expect(ticketFlagsFromJiraAlerts(intake.listAlerts(), 'SNPL-1')).toEqual({ jiraChanged: true })
    expect(ticketFlagsFromJiraAlerts(intake.listAlerts(), 'SNPL-2')).toEqual({})
  })

  it('records an assignee change alert and survives a restart', async () => {
    jira.issues = [issue()]
    const intake = await openIntake()
    await intake.syncNow()
    jira.issues = [issue({ assigneeName: 'Someone', updatedAt: '2026-10-28T11:00:00.000Z' })]
    await intake.syncNow()
    const reopened = await openIntake()
    expect(reopened.listAlerts()).toMatchObject([
      { kind: 'assignee', oldValue: 'Kareem', newValue: 'Someone' }
    ])
  })

  it('records a description alert from the hash, without storing the text', async () => {
    jira.issues = [issue()]
    jira.descriptions['SNPL-1'] = 'old text'
    const intake = await openIntake()
    await intake.syncNow()
    jira.descriptions['SNPL-1'] = 'new secret text'
    jira.issues = [issue({ updatedAt: '2026-10-28T11:00:00.000Z' })]
    await intake.syncNow()
    expect(intake.listAlerts()).toMatchObject([{ kind: 'description' }])
    const saved = await readFile(join(directory, 'jira-intake.json'), 'utf-8')
    expect(saved).not.toContain('new secret text')
  })

  it('dismisses an alert', async () => {
    jira.issues = [issue()]
    const intake = await openIntake()
    await intake.syncNow()
    jira.issues = [issue({ statusName: 'Done', updatedAt: '2026-10-28T11:00:00.000Z' })]
    await intake.syncNow()
    const [alert] = intake.listAlerts()
    await intake.dismissAlert(alert.id)
    expect(intake.listAlerts()).toEqual([])
    expect((await openIntake()).listAlerts()).toEqual([])
  })

  it('keeps tickets and the last good sync time when Jira fails', async () => {
    jira.issues = [issue()]
    const intake = await openIntake()
    await intake.syncNow()
    const lastGood = intake.getStatus().lastGoodSyncAt
    jira.failure = new Error('Jira is down')
    const result = await intake.syncNow()
    expect(result.status).toMatchObject({
      lastGoodSyncAt: lastGood,
      lastError: expect.stringContaining('Jira is down'),
      tokenProblem: false
    })
    expect(tickets.list()).toHaveLength(1)
  })

  it('flags a token problem for an expired token or a missing connection', async () => {
    const intake = await openIntake()
    jira.failure = new Error('token expired')
    expect((await intake.syncNow()).status.tokenProblem).toBe(true)
    jira.failure = null
    jira.connected = false
    const result = await intake.syncNow()
    expect(result.status.tokenProblem).toBe(true)
    expect(result.status.lastGoodSyncAt).toBeNull()
  })

  it('never wipes tickets when the search returns nothing', async () => {
    jira.issues = [issue()]
    const intake = await openIntake()
    await intake.syncNow()
    jira.issues = []
    await intake.syncNow()
    expect(tickets.list()).toHaveLength(1)
  })

  it('only reads from Jira: the intake code references no write function', async () => {
    const forbidden = [
      'updateIssue',
      'createIssue',
      'addIssueComment',
      'transitionIssue',
      "method: 'POST'",
      "method: 'PUT'",
      "method: 'DELETE'",
      'jira-issue-mutations'
    ]
    const sourceDirectory = __dirname
    const files = (await readdir(sourceDirectory)).filter(
      (name) => name.startsWith('jira-') && name.endsWith('.ts') && !name.endsWith('.test.ts')
    )
    expect(files).toContain('jira-read-client.ts')
    for (const file of files) {
      const source = await readFile(join(sourceDirectory, file), 'utf-8')
      for (const name of forbidden) {
        expect(source, `${file} mentions ${name}`).not.toContain(name)
      }
    }
  })
})
