export const MAX_RUNNING_AGENTS = 5

export type RunnerStartResult = { status: 'started' } | { status: 'queued'; position: number }

export type RunnerStatus = {
  running: number
  max: number
  queued: string[]
}

const MAX_SLUG_LENGTH = 60

function slugFromSummary(summary: string): string {
  const flat = summary
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (flat.length <= MAX_SLUG_LENGTH) {
    return flat
  }
  const head = flat.slice(0, MAX_SLUG_LENGTH + 1)
  const boundary = head.lastIndexOf('-')
  const cut =
    flat[MAX_SLUG_LENGTH] === '-'
      ? flat.slice(0, MAX_SLUG_LENGTH)
      : head.slice(0, boundary > 0 ? boundary : MAX_SLUG_LENGTH)
  return cut.replace(/-+$/g, '')
}

// Why: follows Jira's own branch naming, `<ISSUE-KEY>-<summary slug>`, with the key kept as written.
export function ticketBranchName(ticketKey: string, title: string): string {
  const key = ticketKey.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ticket'
  const slug = slugFromSummary(title)
  return slug ? `${key}-${slug}` : key
}
