import type {
  AgentLauncher,
  TicketSandbox
} from '../../../shared/autosfactory/ticket-runner-contract'

const NOT_WIRED = 'The ticket runner is not wired to a sandbox and agent launcher yet.'

function notWired(): Promise<never> {
  return Promise.reject(new Error(NOT_WIRED))
}

export const notWiredSandbox: TicketSandbox = {
  ensureReady: notWired,
  updateSharedRepo: notWired,
  createSession: notWired,
  stopSession: notWired,
  destroySession: notWired,
  listSessions: notWired
}

export const notWiredLauncher: AgentLauncher = {
  start: notWired
}

export function notWiredResolveSource(): Promise<never> {
  return Promise.reject(new Error('No repository source is configured for tickets yet.'))
}
