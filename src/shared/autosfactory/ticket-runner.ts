export const MAX_RUNNING_AGENTS = 5

export type RunnerStartResult = { status: 'started' } | { status: 'queued'; position: number }

export type RunnerStatus = {
  running: number
  max: number
  queued: string[]
}

export function ticketBranchName(ticketKey: string): string {
  const safe = ticketKey
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')
  return `autosfactory/${safe || 'ticket'}`
}
