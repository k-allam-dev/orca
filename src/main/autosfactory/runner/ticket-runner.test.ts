import { describe, expect, it } from 'vitest'
import { ticketBranchName } from '../../../shared/autosfactory/ticket-runner'
import type {
  AgentHandle,
  SandboxSession,
  SandboxSource,
  TicketSandbox
} from '../../../shared/autosfactory/ticket-runner-contract'
import {
  TICKET_RECORD_VERSION,
  type TicketRecord,
  type TicketRecordPatch
} from '../../../shared/autosfactory/ticket-state'
import { assertBranchName } from '../sandbox/ticket-user'
import { TicketRunner, type RunnerTicketStore } from './ticket-runner'

type ExitResult = { code: number | null; interrupted: boolean }

function makeStore(
  keys: string[],
  titles: Record<string, string> = {}
): RunnerTicketStore & { records: Map<string, TicketRecord> } {
  const records = new Map<string, TicketRecord>()
  for (const key of keys) {
    records.set(key, {
      version: TICKET_RECORD_VERSION,
      key,
      title: titles[key] ?? key,
      state: 'implementing',
      agentStatus: 'idle',
      agent: 'claude',
      conversationId: null,
      worktreePath: null,
      repoId: null,
      handoffNote: '',
      createdAt: '',
      updatedAt: ''
    })
  }
  return {
    records,
    get: (key) => records.get(key) ?? null,
    update: async (key, patch: TicketRecordPatch) => {
      const next = { ...records.get(key)!, ...patch }
      records.set(key, next)
      return next
    },
    markRunningInterrupted: async () => {
      const changed: string[] = []
      for (const record of records.values()) {
        if (record.agentStatus === 'running') {
          records.set(record.key, { ...record, agentStatus: 'interrupted' })
          changed.push(record.key)
        }
      }
      return changed
    }
  }
}

function makeHarness(
  keys: string[],
  options: {
    readyError?: Error
    updateError?: Error
    warning?: string
    titles?: Record<string, string>
  } = {}
) {
  const store = makeStore(keys, options.titles)
  const exits = new Map<string, (result: ExitResult) => void>()
  const calls: string[] = []
  const sources: SandboxSource[] = []
  const updates: string[][] = []
  const failure: { updateError?: Error } = { updateError: options.updateError }
  let ensureCalls = 0
  const sandbox: TicketSandbox = {
    ensureReady: async () => {
      ensureCalls += 1
      if (options.readyError) {
        throw options.readyError
      }
    },
    applyPolicy: async (ticketKey) => ({
      claudeSettings: `/p/${ticketKey}/c.json`,
      antigravitySettings: `/p/${ticketKey}/a.json`
    }),
    updateSharedRepo: async (repoKey, windowsRepoPath) => {
      if (failure.updateError) {
        throw failure.updateError
      }
      updates.push([repoKey, windowsRepoPath])
      return { warning: options.warning ?? null }
    },
    createSession: async (ticketKey, source): Promise<SandboxSession> => {
      sources.push(source)
      return {
        ticketKey,
        linuxUser: `u-${ticketKey}`,
        homeDir: `/home/${ticketKey}`,
        worktreeDir: `/home/${ticketKey}/work`
      }
    },
    stopSession: async (key) => void calls.push(`stop:${key}`),
    destroySession: async (key) => void calls.push(`destroy:${key}`),
    listSessions: async () => []
  }
  let counter = 0
  const runner = new TicketRunner({
    store,
    sandbox,
    resolveSource: async () => ({ repoKey: 'orca', windowsRepoPath: 'C:\work\orca' }),
    launcher: {
      start: async (_session, ticketKey): Promise<AgentHandle> => {
        counter += 1
        const exited = new Promise<ExitResult>((resolve) => exits.set(ticketKey, resolve))
        return {
          id: `agent-${counter}`,
          exited,
          stop: async () => {
            calls.push(`agent-stop:${ticketKey}`)
            exits.get(ticketKey)?.({ code: null, interrupted: true })
          }
        }
      }
    }
  })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return {
    store,
    runner,
    exits,
    calls,
    sources,
    updates,
    failure,
    settle,
    ensureCount: () => ensureCalls
  }
}

const SIX = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6']

describe('TicketRunner', () => {
  it('runs five agents and starts the queued sixth when one finishes', async () => {
    const h = makeHarness(SIX)
    for (const key of SIX.slice(0, 5)) {
      expect(await h.runner.start(key)).toEqual({ status: 'started' })
    }
    expect(await h.runner.start('T-6')).toEqual({ status: 'queued', position: 1 })
    expect(h.runner.getStatus()).toEqual({ running: 5, max: 5, queued: ['T-6'] })
    expect(h.store.get('T-6')?.agentStatus).toBe('idle')

    h.exits.get('T-2')?.({ code: 0, interrupted: false })
    await h.settle()
    expect(h.runner.getStatus()).toEqual({ running: 5, max: 5, queued: [] })
    expect(h.store.get('T-6')).toMatchObject({
      agentStatus: 'running',
      worktreePath: '/home/T-6/work'
    })
    expect(h.store.get('T-2')?.agentStatus).toBe('idle')
  })

  it('pauses keeping the session and conversation, and resumes', async () => {
    const h = makeHarness(['T-1'])
    await h.runner.start('T-1')
    const conversationId = h.store.get('T-1')?.conversationId
    await h.runner.pause('T-1')
    expect(h.store.get('T-1')).toMatchObject({
      agentStatus: 'paused',
      conversationId,
      worktreePath: '/home/T-1/work'
    })
    expect(h.calls).toContain('stop:T-1')
    expect(h.calls).not.toContain('destroy:T-1')
    expect(h.runner.getStatus().running).toBe(0)
    await h.runner.start('T-1')
    expect(h.store.get('T-1')?.agentStatus).toBe('running')
  })

  it('refuses to cancel without confirmation and destroys the session when confirmed', async () => {
    const h = makeHarness(['T-1'])
    await h.runner.start('T-1')
    await expect(h.runner.cancel('T-1', { confirmed: false })).rejects.toThrow(/Confirm/)
    expect(h.store.get('T-1')?.agentStatus).toBe('running')
    await h.runner.cancel('T-1', { confirmed: true })
    expect(h.calls).toEqual(['agent-stop:T-1', 'destroy:T-1'])
    expect(h.store.get('T-1')).toMatchObject({
      agentStatus: 'idle',
      worktreePath: null,
      conversationId: null
    })
    expect(h.runner.getStatus().running).toBe(0)
  })

  it('leaves running tickets interrupted after a restart and starts nothing', async () => {
    const h = makeHarness(['T-1', 'T-2'])
    await h.store.update('T-1', { agentStatus: 'running' })
    expect(await h.runner.recover()).toEqual(['T-1'])
    await h.settle()
    expect(h.store.get('T-1')?.agentStatus).toBe('interrupted')
    expect(h.runner.getStatus()).toEqual({ running: 0, max: 5, queued: [] })
    await h.runner.start('T-1')
    expect(h.store.get('T-1')?.agentStatus).toBe('running')
  })

  it('marks a failed agent failed and frees its slot', async () => {
    const h = makeHarness(SIX)
    for (const key of SIX) {
      await h.runner.start(key)
    }
    h.exits.get('T-1')?.({ code: 2, interrupted: false })
    await h.settle()
    expect(h.store.get('T-1')?.agentStatus).toBe('failed')
    expect(h.store.get('T-6')?.agentStatus).toBe('running')
  })

  it('marks an unexpected interruption interrupted', async () => {
    const h = makeHarness(['T-1'])
    await h.runner.start('T-1')
    h.exits.get('T-1')?.({ code: null, interrupted: true })
    await h.settle()
    expect(h.store.get('T-1')?.agentStatus).toBe('interrupted')
  })

  it('refuses to start when the sandbox is not ready', async () => {
    const h = makeHarness(['T-1'], { readyError: new Error('firewall rule missing') })
    await expect(h.runner.start('T-1')).rejects.toThrow(/firewall rule missing/)
    expect(h.store.get('T-1')?.agentStatus).toBe('failed')
    expect(h.runner.getStatus().running).toBe(0)
    expect(h.sources).toHaveLength(0)
  })

  it('checks the sandbox on every start, refreshes the shared repo and branches from develop', async () => {
    const h = makeHarness(['SNPL-12', 'SNPL-13'], { titles: { 'SNPL-12': 'Fix the login!' } })
    await h.runner.start('SNPL-12')
    await h.runner.start('SNPL-13')
    expect(h.ensureCount()).toBe(2)
    expect(h.updates).toEqual([
      ['orca', 'C:\work\orca'],
      ['orca', 'C:\work\orca']
    ])
    expect(h.sources).toEqual([
      { repoKey: 'orca', baseBranch: 'develop', workBranch: 'SNPL-12-fix-the-login' },
      { repoKey: 'orca', baseBranch: 'develop', workBranch: 'SNPL-13-snpl-13' }
    ])
  })

  it('stores the launch error on the ticket and clears it after a good start', async () => {
    const h = makeHarness(['T-1'], { updateError: new Error('git fetch failed') })
    await expect(h.runner.start('T-1')).rejects.toThrow(/git fetch failed/)
    expect(h.store.get('T-1')?.lastError).toMatch(/git fetch failed/)
    expect(h.store.get('T-1')?.agentStatus).toBe('failed')

    const ok = makeHarness(['T-1'])
    await ok.store.update('T-1', { lastError: 'old problem' })
    await ok.runner.start('T-1')
    expect(ok.store.get('T-1')?.lastError).toBeNull()
  })

  it('stores the launch error of a queued ticket that fails to start', async () => {
    const h = makeHarness(SIX)
    for (const key of SIX) {
      await h.runner.start(key)
    }
    h.failure.updateError = new Error('disk full')
    h.exits.get('T-1')?.({ code: 0, interrupted: false })
    await h.settle()
    expect(h.store.get('T-6')).toMatchObject({ agentStatus: 'failed', lastError: 'disk full' })
    expect(h.runner.getStatus().queued).toEqual([])
  })

  it('removes a queued ticket from the queue on pause', async () => {
    const h = makeHarness(SIX)
    for (const key of SIX) {
      await h.runner.start(key)
    }
    await h.runner.pause('T-6')
    expect(h.runner.getStatus().queued).toEqual([])
  })
})

describe('TicketRunner warnings', () => {
  it('stores the stale-code warning and clears it on a clean start', async () => {
    const h = makeHarness(['T-1'], { warning: 'Could not fetch orca; using its last copy.' })
    await h.runner.start('T-1')
    expect(h.store.get('T-1')?.lastWarning).toMatch(/last copy/)
    expect(h.store.get('T-1')?.agentStatus).toBe('running')

    const clean = makeHarness(['T-1'])
    await clean.store.update('T-1', { lastWarning: 'old' })
    await clean.runner.start('T-1')
    expect(clean.store.get('T-1')?.lastWarning).toBeNull()
  })

  it('always branches from the remote develop and never from a local branch', async () => {
    const h = makeHarness(['T-1'])
    await h.runner.start('T-1')
    expect(h.sources[0].baseBranch).toBe('develop')
  })
})

describe('ticketBranchName', () => {
  it('follows the Jira convention', () => {
    expect(
      ticketBranchName('JS-2652', 'Replace and add documents on balance transfer requests')
    ).toBe('JS-2652-replace-and-add-documents-on-balance-transfer-requests')
  })

  it('collapses punctuation and trims dashes', () => {
    expect(ticketBranchName('JS-1', '  [Bug]: Fix "login" -- now!! ')).toBe(
      'JS-1-bug-fix-login-now'
    )
    expect(ticketBranchName('JS-1', 'Café über naïve')).toBe('JS-1-cafe-uber-naive')
  })

  it('falls back to the key for an empty or symbol-only summary', () => {
    expect(ticketBranchName('JS-7', '')).toBe('JS-7')
    expect(ticketBranchName('JS-7', '  ?!  ')).toBe('JS-7')
  })

  it('cuts the slug at 60 characters on a word boundary', () => {
    const name = ticketBranchName(
      'JS-9',
      'Replace and add documents on balance transfer requests for every customer segment'
    )
    expect(name).toBe('JS-9-replace-and-add-documents-on-balance-transfer-requests-for')
    expect(name.slice('JS-9-'.length).length).toBeLessThanOrEqual(60)
    expect(ticketBranchName('JS-9', 'x'.repeat(100))).toBe(`JS-9-${'x'.repeat(60)}`)
  })

  it('always yields a name that passes the branch validation', () => {
    for (const title of ['a/../b', 'x.lock', '~^:?*[\\ y', '-lead', 'end.', '...']) {
      expect(() => assertBranchName(ticketBranchName('JS-3', title))).not.toThrow()
    }
    expect(() => assertBranchName(ticketBranchName('bad key/../x~^', 'T'))).not.toThrow()
  })
})

describe('assertBranchName', () => {
  it('accepts jira style names', () => {
    expect(() => assertBranchName('JS-2652-replace-and-add')).not.toThrow()
    expect(() => assertBranchName('develop')).not.toThrow()
  })

  it.each([
    'a..b',
    'a b',
    'a~b',
    'a^b',
    'a:b',
    'a?b',
    'a*b',
    'a[b',
    'a\\b',
    '-lead',
    'x.lock',
    'a/.hidden',
    'end/',
    'end.',
    ''
  ])('rejects %j', (name) => {
    expect(() => assertBranchName(name)).toThrow(/Invalid branch name/)
  })
})
