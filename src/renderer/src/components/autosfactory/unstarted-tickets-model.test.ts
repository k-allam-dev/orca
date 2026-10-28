import { describe, expect, it } from 'vitest'
import type { TicketRecord } from '../../../../shared/autosfactory/ticket-state'
import { selectUnstartedTickets, syncBannerFor } from './unstarted-tickets-model'

function ticket(overrides: Partial<TicketRecord>): TicketRecord {
  return {
    version: 1,
    key: 'SNPL-1',
    title: 'T',
    state: 'new',
    agentStatus: 'idle',
    agent: null,
    conversationId: null,
    worktreePath: null,
    repoId: null,
    handoffNote: '',
    createdAt: '',
    updatedAt: '',
    ...overrides
  }
}

describe('selectUnstartedTickets', () => {
  it('keeps new tickets with no workspace and drops started ones', () => {
    const tickets = [
      ticket({ key: 'SNPL-1' }),
      ticket({ key: 'SNPL-2', worktreePath: '/w' }),
      ticket({ key: 'SNPL-3', state: 'planning' }),
      ticket({ key: 'SNPL-4' })
    ]
    const worktrees = [{ linkedWorkItem: { provider: 'jira', jiraIdentifier: 'SNPL-4' } }]
    expect(selectUnstartedTickets(tickets, worktrees).map((t) => t.key)).toEqual(['SNPL-1'])
  })
})

describe('syncBannerFor', () => {
  const base = { lastGoodSyncAt: '2026-10-28T10:00:00Z', lastAttemptAt: null }
  it('shows nothing when healthy', () => {
    expect(syncBannerFor({ ...base, lastError: null, tokenProblem: false })).toEqual({
      kind: 'none'
    })
  })
  it('separates not connected, token and other errors', () => {
    expect(
      syncBannerFor({ ...base, lastError: 'Jira is not connected. x', tokenProblem: true }).kind
    ).toBe('not-connected')
    expect(syncBannerFor({ ...base, lastError: 'bad', tokenProblem: true }).kind).toBe('token')
    expect(syncBannerFor({ ...base, lastError: 'down', tokenProblem: false }).kind).toBe('error')
  })
})
