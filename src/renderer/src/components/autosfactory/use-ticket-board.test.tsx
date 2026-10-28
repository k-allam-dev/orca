// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TicketRecord } from '../../../../shared/autosfactory/ticket-state'
import { useTicketBoard } from './use-ticket-board'

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

const listTickets = vi.fn()
const moveTicket = vi.fn()

beforeEach(() => {
  listTickets.mockReset()
  moveTicket.mockReset()
  Object.assign(window, { api: { autosfactory: { listTickets, moveTicket } } })
})

describe('useTicketBoard', () => {
  it('loads tickets and moves one through the store', async () => {
    listTickets.mockResolvedValue([ticket('A-1', 'new')])
    moveTicket.mockResolvedValue(ticket('A-1', 'implementing'))
    const { result } = renderHook(() => useTicketBoard())
    await waitFor(() => expect(result.current.tickets).toHaveLength(1))
    await act(async () => result.current.moveTicket('A-1', 'implementing'))
    expect(moveTicket).toHaveBeenCalledWith({ key: 'A-1', state: 'implementing' })
    expect(result.current.tickets[0].state).toBe('implementing')
  })

  it('reloads from the store and reports the error when a move fails', async () => {
    listTickets.mockResolvedValue([ticket('A-1', 'new')])
    moveTicket.mockRejectedValue(new Error('disk full'))
    const { result } = renderHook(() => useTicketBoard())
    await waitFor(() => expect(result.current.tickets).toHaveLength(1))
    await act(async () => result.current.moveTicket('A-1', 'done'))
    await waitFor(() => expect(listTickets).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.error).toBe('disk full'))
    expect(result.current.tickets[0].state).toBe('new')
  })
})
