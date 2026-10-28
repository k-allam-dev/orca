import type {
  AgentHandle,
  AgentLauncher,
  TicketSandbox
} from '../../../shared/autosfactory/ticket-runner-contract'
import { SANDBOX_BASE_BRANCH } from '../../../shared/autosfactory/sandbox-config'
import {
  MAX_RUNNING_AGENTS,
  ticketBranchName,
  type RunnerStartResult,
  type RunnerStatus
} from '../../../shared/autosfactory/ticket-runner'
import type { TicketRecord, TicketRecordPatch } from '../../../shared/autosfactory/ticket-state'

export type RunnerTicketStore = {
  get(key: string): TicketRecord | null
  update(key: string, patch: TicketRecordPatch): Promise<TicketRecord>
  markRunningInterrupted(): Promise<string[]>
}

export type TicketRunnerDeps = {
  store: RunnerTicketStore
  sandbox: TicketSandbox
  launcher: AgentLauncher
  resolveSource: (ticket: TicketRecord) => Promise<{ repoKey: string; windowsRepoPath: string }>
  maxRunning?: number
}

type ActiveRun = {
  handle: AgentHandle | null
  launching: Promise<void>
}

export class TicketRunner {
  private readonly active = new Map<string, ActiveRun>()
  private readonly queue: string[] = []
  private readonly max: number

  constructor(private readonly deps: TicketRunnerDeps) {
    this.max = deps.maxRunning ?? MAX_RUNNING_AGENTS
  }

  // Why: after an app restart nothing resumes on its own; stored `running` tickets become `interrupted`.
  async recover(): Promise<string[]> {
    return this.deps.store.markRunningInterrupted()
  }

  getStatus(): RunnerStatus {
    return { running: this.active.size, max: this.max, queued: [...this.queue] }
  }

  async start(key: string): Promise<RunnerStartResult> {
    this.requireTicket(key)
    if (this.active.has(key)) {
      return { status: 'started' }
    }
    const queued = this.queue.indexOf(key)
    if (queued >= 0) {
      return { status: 'queued', position: queued + 1 }
    }
    if (this.active.size >= this.max) {
      this.queue.push(key)
      return { status: 'queued', position: this.queue.length }
    }
    await this.launch(key)
    return { status: 'started' }
  }

  async pause(key: string): Promise<void> {
    const ticket = this.requireTicket(key)
    if (this.removeFromQueue(key)) {
      return
    }
    const run = this.active.get(key)
    if (!run) {
      if (ticket.agentStatus === 'running' || ticket.agentStatus === 'interrupted') {
        await this.deps.store.update(key, { agentStatus: 'paused' })
      }
      return
    }
    await this.halt(key, run)
    await this.deps.sandbox.stopSession(key)
    await this.deps.store.update(key, { agentStatus: 'paused' })
    this.release(key)
  }

  async cancel(key: string, options: { confirmed: boolean }): Promise<void> {
    this.requireTicket(key)
    if (options.confirmed !== true) {
      throw new Error(
        `Cancelling ${key} deletes its worktree, branch and sandbox user. Confirm to continue.`
      )
    }
    this.removeFromQueue(key)
    const run = this.active.get(key)
    if (run) {
      await this.halt(key, run)
    }
    try {
      await this.deps.sandbox.destroySession(key)
    } finally {
      this.release(key)
    }
    await this.deps.store.update(key, {
      agentStatus: 'idle',
      worktreePath: null,
      conversationId: null,
      lastError: null
    })
  }

  private async halt(key: string, run: ActiveRun): Promise<void> {
    await run.launching.catch(() => undefined)
    const current = this.active.get(key)
    if (current?.handle) {
      const handle = current.handle
      current.handle = null
      await handle.stop()
    }
  }

  private async launch(key: string): Promise<void> {
    const run: ActiveRun = { handle: null, launching: Promise.resolve() }
    this.active.set(key, run)
    run.launching = this.startAgent(key, run)
    try {
      await run.launching
    } catch (error) {
      this.release(key)
      await this.recordLaunchError(key, error)
      throw error
    }
  }

  private async startAgent(key: string, run: ActiveRun): Promise<void> {
    const ticket = this.requireTicket(key)
    await this.ensureSandboxReady()
    const source = await this.deps.resolveSource(ticket)
    await this.deps.sandbox.updateSharedRepo(source.repoKey, source.windowsRepoPath)
    const session = await this.deps.sandbox.createSession(key, {
      repoKey: source.repoKey,
      baseBranch: SANDBOX_BASE_BRANCH,
      workBranch: ticketBranchName(key)
    })
    const handle = await this.deps.launcher.start(session, key)
    run.handle = handle
    await this.deps.store.update(key, {
      agentStatus: 'running',
      worktreePath: session.worktreeDir,
      conversationId: handle.id,
      lastError: null
    })
    void handle.exited.then(
      (result) => this.onExit(key, handle, result),
      () => this.onExit(key, handle, { code: 1, interrupted: false })
    )
  }

  // Why: checked on every start, so a firewall or wsl.conf change since the last start is caught.
  private async ensureSandboxReady(): Promise<void> {
    try {
      await this.deps.sandbox.ensureReady()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`The sandbox is not ready, so no agent was started: ${reason}`)
    }
  }

  private async recordLaunchError(key: string, error: unknown): Promise<void> {
    const lastError = error instanceof Error ? error.message : String(error)
    await this.deps.store.update(key, { lastError }).catch(() => undefined)
  }

  private async onExit(
    key: string,
    handle: AgentHandle,
    result: { code: number | null; interrupted: boolean }
  ): Promise<void> {
    const run = this.active.get(key)
    if (!run || run.handle !== handle) {
      return
    }
    const agentStatus = result.interrupted ? 'interrupted' : result.code === 0 ? 'idle' : 'failed'
    this.active.delete(key)
    try {
      await this.deps.store.update(key, { agentStatus })
    } finally {
      this.drain()
    }
  }

  private release(key: string): void {
    this.active.delete(key)
    this.drain()
  }

  private drain(): void {
    while (this.active.size < this.max && this.queue.length > 0) {
      const next = this.queue.shift()
      if (next === undefined) {
        return
      }
      void this.launch(next).catch(async () => {
        await this.deps.store.update(next, { agentStatus: 'failed' }).catch(() => undefined)
      })
    }
  }

  private removeFromQueue(key: string): boolean {
    const index = this.queue.indexOf(key)
    if (index < 0) {
      return false
    }
    this.queue.splice(index, 1)
    return true
  }

  private requireTicket(key: string): TicketRecord {
    const ticket = this.deps.store.get(key)
    if (!ticket) {
      throw new Error(`Unknown ticket: ${key}`)
    }
    return ticket
  }
}
