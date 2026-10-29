import { describe, expect, it } from 'vitest'
import { describeRefreshStatus, SANDBOX_NOT_SET_UP_MESSAGE } from './shared-repo-refresh'

describe('describeRefreshStatus', () => {
  it('says the sandbox is not set up', () => {
    expect(
      describeRefreshStatus({ state: 'not-set-up', lastRefreshAt: null, results: [] })
    ).toEqual([SANDBOX_NOT_SET_UP_MESSAGE])
  })

  it('lists one line per repo with its result', () => {
    const lines = describeRefreshStatus({
      state: 'done',
      lastRefreshAt: '2026-10-29T10:00:00.000Z',
      results: [
        { repoKey: 'a', ok: true, warning: null, error: null },
        { repoKey: 'b', ok: true, warning: 'old copy', error: null },
        { repoKey: 'c', ok: false, warning: null, error: 'boom' }
      ]
    })
    expect(lines.slice(1)).toEqual(['a: up to date', 'b: stale, old copy', 'c: error, boom'])
    expect(lines[0]).toMatch(/^Code last refreshed/)
  })
})
