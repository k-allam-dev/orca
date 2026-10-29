import type {
  AgentLauncher,
  TicketSandbox
} from '../../../shared/autosfactory/ticket-runner-contract'

const NOT_WIRED = 'The ticket runner is not wired to a sandbox and agent launcher yet.'

export class NotWiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotWiredError'
  }
}

function notWired(): Promise<never> {
  return Promise.reject(new NotWiredError(NOT_WIRED))
}

export const notWiredSandbox: TicketSandbox = {
  ensureReady: notWired,
  updateSharedRepo: notWired,
  createSession: notWired,
  stopSession: notWired,
  destroySession: notWired,
  listSessions: notWired,
  applyPolicy: notWired
}

export const notWiredLauncher: AgentLauncher = {
  start: notWired
}

export function notWiredResolveSource(): Promise<never> {
  return Promise.reject(new NotWiredError('No repository source is configured for tickets yet.'))
}

export function notWiredListRepos(): Promise<never> {
  return Promise.reject(new NotWiredError('No repositories are configured for tickets yet.'))
}
