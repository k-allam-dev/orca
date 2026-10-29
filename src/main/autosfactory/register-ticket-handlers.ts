import { ipcMain } from 'electron'
import { join } from 'node:path'
import {
  isTicketAgent,
  isTicketAgentStatus,
  isTicketKey,
  isTicketState,
  type TicketRecord,
  type TicketRecordPatch
} from '../../shared/autosfactory/ticket-state'
import { JIRA_INTAKE_INTERVAL_MS, type JiraSyncResult } from '../../shared/autosfactory/jira-intake'
import { JiraIntake } from './jira-intake'
import { orcaJiraReadClient } from './jira-read-client'
import { TicketRunner } from './runner/ticket-runner'
import {
  notWiredLauncher,
  notWiredListRepos,
  notWiredResolveSource,
  notWiredSandbox
} from './runner/not-wired'
import { SharedRepoRefresher } from './runner/shared-repo-refresher'
import { TicketStateStore } from './ticket-state-store'

function parsePatch(value: unknown): TicketRecordPatch {
  const fields: Record<string, unknown> = Object.fromEntries(
    Object.entries(typeof value === 'object' && value !== null ? value : {})
  )
  const patch: TicketRecordPatch = {}
  if (isTicketAgentStatus(fields.agentStatus)) {
    patch.agentStatus = fields.agentStatus
  }
  if (fields.agent === null || isTicketAgent(fields.agent)) {
    patch.agent = fields.agent
  }
  if (fields.conversationId === null || typeof fields.conversationId === 'string') {
    patch.conversationId = fields.conversationId
  }
  if (fields.worktreePath === null || typeof fields.worktreePath === 'string') {
    patch.worktreePath = fields.worktreePath
  }
  if (fields.repoId === null || (typeof fields.repoId === 'string' && fields.repoId.length > 0)) {
    patch.repoId = fields.repoId
  }
  if (typeof fields.handoffNote === 'string') {
    patch.handoffNote = fields.handoffNote
  }
  return patch
}

export function registerTicketHandlers(userDataPath: string): void {
  const store = new TicketStateStore(join(userDataPath, 'autosfactory', 'tickets'))
  const ready = store.load().then(() => store.markRunningInterrupted())

  ipcMain.handle('autosfactory:tickets:list', async (): Promise<TicketRecord[]> => {
    await ready
    return store.list()
  })

  ipcMain.handle(
    'autosfactory:tickets:create',
    async (_event, args: { key?: unknown; title?: unknown }) => {
      await ready
      if (!isTicketKey(args?.key) || typeof args.title !== 'string') {
        throw new Error('A valid ticket key and a title are required.')
      }
      return store.create({ key: args.key, title: args.title })
    }
  )

  ipcMain.handle(
    'autosfactory:tickets:move',
    async (_event, args: { key?: unknown; state?: unknown }) => {
      await ready
      if (!isTicketKey(args?.key) || !isTicketState(args.state)) {
        throw new Error('A valid ticket key and state are required.')
      }
      return store.moveTo(args.key, args.state)
    }
  )

  ipcMain.handle(
    'autosfactory:tickets:update',
    async (_event, args: { key?: unknown; patch?: unknown }) => {
      await ready
      if (!isTicketKey(args?.key)) {
        throw new Error('A valid ticket key is required.')
      }
      return store.update(args.key, parsePatch(args.patch))
    }
  )

  ipcMain.handle('autosfactory:tickets:remove', async (_event, args: { key?: unknown }) => {
    await ready
    if (!isTicketKey(args?.key)) {
      throw new Error('A valid ticket key is required.')
    }
    await store.remove(args.key)
  })

  const runner = new TicketRunner({
    store,
    sandbox: notWiredSandbox,
    launcher: notWiredLauncher,
    resolveSource: notWiredResolveSource
  })
  const refresher = new SharedRepoRefresher({
    sandbox: notWiredSandbox,
    listRepos: notWiredListRepos
  })
  refresher.start()
  ipcMain.handle('autosfactory:repos:refresh', () => refresher.refreshNow())
  ipcMain.handle('autosfactory:repos:refresh-status', () => refresher.getStatus())
  const requireKey = (args: { key?: unknown } | undefined): string => {
    if (!isTicketKey(args?.key)) {
      throw new Error('A valid ticket key is required.')
    }
    return args.key
  }
  ipcMain.handle('autosfactory:runner:start', async (_event, args: { key?: unknown }) => {
    await ready
    return runner.start(requireKey(args))
  })
  ipcMain.handle('autosfactory:runner:pause', async (_event, args: { key?: unknown }) => {
    await ready
    await runner.pause(requireKey(args))
  })
  ipcMain.handle(
    'autosfactory:runner:cancel',
    async (_event, args: { key?: unknown; confirmed?: unknown }) => {
      await ready
      await runner.cancel(requireKey(args), { confirmed: args?.confirmed === true })
    }
  )
  ipcMain.handle('autosfactory:runner:status', async () => {
    await ready
    return runner.getStatus()
  })

  const intake = new JiraIntake(
    join(userDataPath, 'autosfactory', 'jira-intake.json'),
    store,
    orcaJiraReadClient
  )
  const intakeReady = ready.then(() => intake.load())
  const syncIntake = async (): Promise<JiraSyncResult> => {
    await intakeReady
    return intake.syncNow()
  }
  void syncIntake()
  setInterval(() => void syncIntake(), JIRA_INTAKE_INTERVAL_MS).unref()

  ipcMain.handle('autosfactory:jira:sync-now', syncIntake)
  ipcMain.handle('autosfactory:jira:status', async () => {
    await intakeReady
    return intake.getStatus()
  })
  ipcMain.handle('autosfactory:jira:statuses', async () => {
    await intakeReady
    return intake.listJiraStatuses()
  })
  ipcMain.handle('autosfactory:jira:alerts', async () => {
    await intakeReady
    return intake.listAlerts()
  })
  ipcMain.handle('autosfactory:jira:dismiss-alert', async (_event, args: { id?: unknown }) => {
    await intakeReady
    if (typeof args?.id !== 'string') {
      throw new Error('An alert id is required.')
    }
    await intake.dismissAlert(args.id)
  })
}
