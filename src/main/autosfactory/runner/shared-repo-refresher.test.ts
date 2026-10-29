import { describe, expect, it } from 'vitest'
import { SharedRepoRefresher, type RefresherTimer } from './shared-repo-refresher'
import { NotWiredError, notWiredListRepos, notWiredSandbox } from './not-wired'

function makeTimer() {
  const state: { callback: (() => void) | null; intervalMs: number; cancelled: boolean } = {
    callback: null,
    intervalMs: 0,
    cancelled: false
  }
  const timer: RefresherTimer = {
    every(callback, intervalMs) {
      state.callback = callback
      state.intervalMs = intervalMs
      return () => {
        state.cancelled = true
      }
    }
  }
  return { state, timer }
}

const REPOS = [
  { repoKey: 'orca', windowsRepoPath: 'C:\\p\\orca' },
  { repoKey: 'api', windowsRepoPath: 'C:\\p\\api' }
]

describe('SharedRepoRefresher', () => {
  it('refreshes every listed repo and records per-repo results with the clock time', async () => {
    const calls: string[] = []
    const refresher = new SharedRepoRefresher({
      sandbox: {
        ensureReady: async () => void calls.push('ready'),
        updateSharedRepo: async (repoKey) => {
          calls.push(repoKey)
          if (repoKey === 'api') {
            throw new Error('no copy yet')
          }
          return { warning: 'stale copy' }
        }
      },
      listRepos: async () => REPOS,
      now: () => new Date('2026-10-29T10:00:00.000Z')
    })
    const status = await refresher.refreshNow()
    expect(calls).toEqual(['ready', 'orca', 'api'])
    expect(status).toEqual({
      state: 'done',
      lastRefreshAt: '2026-10-29T10:00:00.000Z',
      results: [
        { repoKey: 'orca', ok: true, warning: 'stale copy', error: null },
        { repoKey: 'api', ok: false, warning: null, error: 'no copy yet' }
      ]
    })
    expect(refresher.getStatus()).toBe(status)
  })

  it('reports a clear state when the sandbox is not wired yet', async () => {
    const refresher = new SharedRepoRefresher({
      sandbox: notWiredSandbox,
      listRepos: async () => REPOS
    })
    expect((await refresher.refreshNow()).state).toBe('not-set-up')
    const noList = new SharedRepoRefresher({
      sandbox: notWiredSandbox,
      listRepos: notWiredListRepos
    })
    expect((await noList.refreshNow()).state).toBe('not-set-up')
    expect(new NotWiredError('x').name).toBe('NotWiredError')
  })

  it('records a sandbox error when it is not ready', async () => {
    const refresher = new SharedRepoRefresher({
      sandbox: {
        ensureReady: async () => {
          throw new Error('firewall missing')
        },
        updateSharedRepo: async () => ({ warning: null })
      },
      listRepos: async () => REPOS
    })
    const status = await refresher.refreshNow()
    expect(status.results[0]).toMatchObject({ ok: false, error: 'firewall missing' })
  })

  it('runs again on every timer tick, every 5 hours by default, and stops', async () => {
    const { state, timer } = makeTimer()
    let runs = 0
    const refresher = new SharedRepoRefresher({
      sandbox: {
        ensureReady: async () => undefined,
        updateSharedRepo: async () => {
          runs += 1
          return { warning: null }
        }
      },
      listRepos: async () => [REPOS[0]],
      timer
    })
    refresher.start()
    refresher.start()
    expect(state.intervalMs).toBe(5 * 60 * 60 * 1000)
    state.callback?.()
    await refresher.refreshNow()
    expect(runs).toBe(1)
    state.callback?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runs).toBe(2)
    refresher.stop()
    expect(state.cancelled).toBe(true)
  })

  it('shares one run between overlapping requests', async () => {
    let runs = 0
    const refresher = new SharedRepoRefresher({
      sandbox: {
        ensureReady: async () => undefined,
        updateSharedRepo: async () => {
          runs += 1
          return { warning: null }
        }
      },
      listRepos: async () => [REPOS[0]]
    })
    await Promise.all([refresher.refreshNow(), refresher.refreshNow()])
    expect(runs).toBe(1)
  })
})
