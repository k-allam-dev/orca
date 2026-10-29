import type { TicketSandbox } from '../../../shared/autosfactory/ticket-runner-contract'
import {
  SHARED_REPO_REFRESH_INTERVAL_MS,
  type RefreshRepoSpec,
  type RepoRefreshResult,
  type SharedRepoRefreshStatus
} from '../../../shared/autosfactory/shared-repo-refresh'
import { NotWiredError } from './not-wired'

export type RefresherTimer = {
  every(callback: () => void, intervalMs: number): () => void
}

export type SharedRepoRefresherDeps = {
  sandbox: Pick<TicketSandbox, 'ensureReady' | 'updateSharedRepo'>
  listRepos: () => Promise<RefreshRepoSpec[]>
  now?: () => Date
  timer?: RefresherTimer
  intervalMs?: number
}

const realTimer: RefresherTimer = {
  every(callback, intervalMs) {
    const handle = setInterval(callback, intervalMs)
    handle.unref()
    return () => clearInterval(handle)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class SharedRepoRefresher {
  private status: SharedRepoRefreshStatus = { state: 'never', lastRefreshAt: null, results: [] }
  private inFlight: Promise<SharedRepoRefreshStatus> | null = null
  private cancelTimer: (() => void) | null = null

  constructor(private readonly deps: SharedRepoRefresherDeps) {}

  start(): void {
    if (this.cancelTimer) {
      return
    }
    const timer = this.deps.timer ?? realTimer
    this.cancelTimer = timer.every(
      () => void this.refreshNow(),
      this.deps.intervalMs ?? SHARED_REPO_REFRESH_INTERVAL_MS
    )
  }

  stop(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  getStatus(): SharedRepoRefreshStatus {
    return this.status
  }

  refreshNow(): Promise<SharedRepoRefreshStatus> {
    if (!this.inFlight) {
      this.inFlight = this.run().finally(() => {
        this.inFlight = null
      })
    }
    return this.inFlight
  }

  private stamp(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString()
  }

  private async run(): Promise<SharedRepoRefreshStatus> {
    this.status = { ...this.status, state: 'running' }
    try {
      const repos = await this.deps.listRepos()
      if (repos.length > 0) {
        await this.deps.sandbox.ensureReady()
      }
      const results: RepoRefreshResult[] = []
      for (const repo of repos) {
        results.push(await this.refreshOne(repo))
      }
      this.status = { state: 'done', lastRefreshAt: this.stamp(), results }
    } catch (error) {
      this.status =
        error instanceof NotWiredError
          ? { state: 'not-set-up', lastRefreshAt: this.status.lastRefreshAt, results: [] }
          : {
              state: 'done',
              lastRefreshAt: this.stamp(),
              results: [{ repoKey: 'sandbox', ok: false, warning: null, error: messageOf(error) }]
            }
    }
    return this.status
  }

  private async refreshOne(repo: RefreshRepoSpec): Promise<RepoRefreshResult> {
    try {
      const update = await this.deps.sandbox.updateSharedRepo(repo.repoKey, repo.windowsRepoPath)
      return { repoKey: repo.repoKey, ok: true, warning: update.warning, error: null }
    } catch (error) {
      if (error instanceof NotWiredError) {
        throw error
      }
      return { repoKey: repo.repoKey, ok: false, warning: null, error: messageOf(error) }
    }
  }
}
