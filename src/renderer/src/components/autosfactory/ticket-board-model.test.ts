import { describe, expect, it } from 'vitest'
import { TICKET_STATES, type TicketRecord } from '../../../../shared/autosfactory/ticket-state'
import { activeTicketFlags, groupTicketsByState, ticketStateLabel } from './ticket-board-model'

function ticket(key: string, state: TicketRecord['state']): TicketRecord {
  return {
    version: 1,
    key,
    title: key,
    state,
    agentStatus: 'idle',
    agent: null,
    conversationId: null,
    worktreePath: null,
    repoId: null,
    handoffNote: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('ticket board model', () => {
  it('groups tickets into one bucket per state, keeping order', () => {
    const grouped = groupTicketsByState([
      ticket('A-1', 'new'),
      ticket('A-2', 'done'),
      ticket('A-3', 'new')
    ])
    expect(Object.keys(grouped)).toEqual([...TICKET_STATES])
    expect(grouped.new.map((t) => t.key)).toEqual(['A-1', 'A-3'])
    expect(grouped.done.map((t) => t.key)).toEqual(['A-2'])
    expect(grouped.planning).toEqual([])
  })

  it('labels every state', () => {
    for (const state of TICKET_STATES) {
      expect(ticketStateLabel(state)).not.toBe('')
    }
  })

  it('lists only flags that are true', () => {
    expect(activeTicketFlags(undefined)).toEqual([])
    expect(activeTicketFlags({ queued: true, usageLimit: false, jiraChanged: true })).toEqual([
      'jiraChanged',
      'queued'
    ])
  })
})
