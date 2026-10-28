import { describe, expect, it } from 'vitest'
import { parseTicketRecord } from './ticket-state'

const saved = {
  version: 1,
  key: 'SNPL-1',
  title: 'T',
  state: 'new',
  agentStatus: 'idle',
  agent: null,
  conversationId: null,
  worktreePath: null,
  handoffNote: '',
  createdAt: 'a',
  updatedAt: 'b'
}

describe('parseTicketRecord repoId', () => {
  it('reads a record saved before repoId existed as null', () => {
    expect(parseTicketRecord(saved)?.repoId).toBeNull()
  })
  it('keeps a string repoId and rejects other types', () => {
    expect(parseTicketRecord({ ...saved, repoId: 'repo-1' })?.repoId).toBe('repo-1')
    expect(parseTicketRecord({ ...saved, repoId: 5 })).toBeNull()
  })
})

describe('parseTicketRecord lastError', () => {
  it('reads a record saved before lastError existed as null', () => {
    expect(parseTicketRecord(saved)?.lastError).toBeNull()
  })
  it('keeps a string lastError and rejects other types', () => {
    expect(parseTicketRecord({ ...saved, lastError: 'boom' })?.lastError).toBe('boom')
    expect(parseTicketRecord({ ...saved, lastError: 5 })).toBeNull()
  })
})
