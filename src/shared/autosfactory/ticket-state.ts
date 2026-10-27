export const TICKET_STATES = [
  'new',
  'planning',
  'plan-ready-for-review',
  'implementing',
  'waiting-on-you',
  'changes-ready-for-review',
  'pr-open',
  'done'
] as const
export type TicketState = (typeof TICKET_STATES)[number]

export const TICKET_AGENT_STATUSES = ['idle', 'running', 'paused', 'interrupted', 'failed'] as const
export type TicketAgentStatus = (typeof TICKET_AGENT_STATUSES)[number]

export const TICKET_AGENTS = ['claude', 'antigravity'] as const
export type TicketAgent = (typeof TICKET_AGENTS)[number]

export const TICKET_RECORD_VERSION = 1

export type TicketRecord = {
  version: typeof TICKET_RECORD_VERSION
  key: string
  title: string
  state: TicketState
  agentStatus: TicketAgentStatus
  agent: TicketAgent | null
  conversationId: string | null
  worktreePath: string | null
  handoffNote: string
  createdAt: string
  updatedAt: string
}

export type TicketRecordPatch = Partial<
  Pick<TicketRecord, 'agentStatus' | 'agent' | 'conversationId' | 'worktreePath' | 'handoffNote'>
>

// Why: the key becomes a file name, so it must never contain path separators or dots.
const TICKET_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/

export function isTicketKey(value: unknown): value is string {
  return typeof value === 'string' && TICKET_KEY_PATTERN.test(value)
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.some((candidate) => candidate === value)
}

export function isTicketState(value: unknown): value is TicketState {
  return isOneOf(TICKET_STATES, value)
}

export function isTicketAgentStatus(value: unknown): value is TicketAgentStatus {
  return isOneOf(TICKET_AGENT_STATUSES, value)
}

export function isTicketAgent(value: unknown): value is TicketAgent {
  return isOneOf(TICKET_AGENTS, value)
}

function stringOrNull(value: unknown): string | null | undefined {
  if (value === null) {
    return null
  }
  return typeof value === 'string' ? value : undefined
}

export function parseTicketRecord(raw: unknown): TicketRecord | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(raw))
  const { version, key, title, state, agentStatus, agent, conversationId, worktreePath } = fields
  const { handoffNote, createdAt, updatedAt } = fields
  const parsedAgent = agent === null ? null : isTicketAgent(agent) ? agent : undefined
  const parsedConversation = stringOrNull(conversationId)
  const parsedWorktree = stringOrNull(worktreePath)
  if (
    version !== TICKET_RECORD_VERSION ||
    !isTicketKey(key) ||
    typeof title !== 'string' ||
    !isTicketState(state) ||
    !isTicketAgentStatus(agentStatus) ||
    parsedAgent === undefined ||
    parsedConversation === undefined ||
    parsedWorktree === undefined ||
    typeof handoffNote !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof updatedAt !== 'string'
  ) {
    return null
  }
  return {
    version,
    key,
    title,
    state,
    agentStatus,
    agent: parsedAgent,
    conversationId: parsedConversation,
    worktreePath: parsedWorktree,
    handoffNote,
    createdAt,
    updatedAt
  }
}
