export const SHARED_REPO_REFRESH_INTERVAL_MS = 5 * 60 * 60 * 1000

export type RefreshRepoSpec = { repoKey: string; windowsRepoPath: string }

export type RepoRefreshResult = {
  repoKey: string
  ok: boolean
  warning: string | null
  error: string | null
}

export type SharedRepoRefreshStatus = {
  state: 'never' | 'running' | 'done' | 'not-set-up'
  lastRefreshAt: string | null
  results: RepoRefreshResult[]
}

export const SANDBOX_NOT_SET_UP_MESSAGE =
  'The sandbox is not set up yet, so the code cannot be refreshed.'

export function describeRefreshStatus(status: SharedRepoRefreshStatus): string[] {
  if (status.state === 'not-set-up') {
    return [SANDBOX_NOT_SET_UP_MESSAGE]
  }
  if (status.state === 'never') {
    return ['Code not refreshed yet in this session.']
  }
  const when = status.lastRefreshAt ? new Date(status.lastRefreshAt).toLocaleString() : 'unknown'
  const head = status.state === 'running' ? 'Refreshing code...' : `Code last refreshed ${when}.`
  const lines = status.results.map((result) =>
    result.error
      ? `${result.repoKey}: error, ${result.error}`
      : result.warning
        ? `${result.repoKey}: stale, ${result.warning}`
        : `${result.repoKey}: up to date`
  )
  return [head, ...lines]
}
