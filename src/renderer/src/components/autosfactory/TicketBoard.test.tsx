// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TICKET_STATES, type TicketRecord } from '../../../../shared/autosfactory/ticket-state'
import { TicketBoard } from './TicketBoard'
import { TICKET_DRAG_TYPE } from './TicketCard'

vi.mock('@/lib/agent-type-icon', () => ({
  AgentTypeIcon: () => <span data-testid="agent-icon" />
}))
vi.mock('@/components/AgentStateDot', () => ({
  AgentStateDot: ({ state }: { state: string }) => <span data-testid="state-dot">{state}</span>
}))

function ticket(overrides: Partial<TicketRecord>): TicketRecord {
  return {
    version: 1,
    key: 'ABC-1',
    title: 'Fix login',
    state: 'new',
    agentStatus: 'idle',
    agent: null,
    conversationId: null,
    worktreePath: null,
    handoffNote: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

afterEach(cleanup)

describe('TicketBoard', () => {
  it('renders eight columns in state order', () => {
    render(<TicketBoard tickets={[]} onMoveTicket={vi.fn()} />)
    const columns = [...document.querySelectorAll('section[data-ticket-state]')]
    expect(columns.map((el) => el.getAttribute('data-ticket-state'))).toEqual([...TICKET_STATES])
  })

  it('puts each card in its state column with key, title, agent, status and flags', () => {
    render(
      <TicketBoard
        tickets={[
          ticket({ key: 'ABC-1', state: 'planning', agent: 'claude', agentStatus: 'running' }),
          ticket({ key: 'ABC-2', title: 'Other', state: 'done' })
        ]}
        flagsByKey={{ 'ABC-1': { permissionRequest: true, queued: true } }}
        onMoveTicket={vi.fn()}
      />
    )
    const planning = screen.getByRole('region', { name: 'Planning' })
    expect(within(planning).getByText('ABC-1')).toBeInTheDocument()
    expect(within(planning).getByText('Fix login')).toBeInTheDocument()
    expect(within(planning).getByText('claude')).toBeInTheDocument()
    expect(within(planning).getByText('Running')).toBeInTheDocument()
    expect(within(planning).getByText('Permission request')).toBeInTheDocument()
    expect(within(planning).getByText('Queued')).toBeInTheDocument()
    expect(within(planning).queryByText('Usage limit')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Done' })).getByText('ABC-2')).toBeVisible()
  })

  it('moves a ticket when its card is dropped on another column', () => {
    const onMoveTicket = vi.fn()
    render(<TicketBoard tickets={[ticket({ key: 'ABC-1' })]} onMoveTicket={onMoveTicket} />)
    const store = new Map<string, string>()
    const dataTransfer = {
      types: [TICKET_DRAG_TYPE],
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? '',
      effectAllowed: '',
      dropEffect: ''
    }
    const card = document.querySelector('[data-ticket-key="ABC-1"]')
    expect(card).not.toBeNull()
    if (!card) {
      return
    }
    fireEvent.dragStart(card, { dataTransfer })
    const target = screen.getByRole('region', { name: 'PR open' })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
    expect(onMoveTicket).toHaveBeenCalledWith('ABC-1', 'pr-open')
  })

  it('moves a ticket from the card menu to any state', () => {
    const onMoveTicket = vi.fn()
    render(<TicketBoard tickets={[ticket({ key: 'ABC-1' })]} onMoveTicket={onMoveTicket} />)
    fireEvent.change(screen.getByLabelText('Move ABC-1 to'), { target: { value: 'done' } })
    expect(onMoveTicket).toHaveBeenCalledWith('ABC-1', 'done')
  })
})
