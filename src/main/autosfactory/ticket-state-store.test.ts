import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TICKET_STATES } from '../../shared/autosfactory/ticket-state'
import { TicketStateStore } from './ticket-state-store'

describe('TicketStateStore', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'autosfactory-tickets-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  async function openStore(): Promise<TicketStateStore> {
    const store = new TicketStateStore(directory)
    await store.load()
    return store
  }

  it('keeps a ticket through all eight states and across a restart', async () => {
    const store = await openStore()
    await store.create({ key: 'SNPL-101', title: 'Fix header' })
    for (const state of TICKET_STATES) {
      await store.moveTo('SNPL-101', state)
    }
    await store.update('SNPL-101', {
      agent: 'claude',
      conversationId: 'conv-1',
      worktreePath: 'worktrees/SNPL-101',
      handoffNote: 'Plan: step 1'
    })

    const reopened = await openStore()
    expect(reopened.get('SNPL-101')).toMatchObject({
      state: 'done',
      agent: 'claude',
      conversationId: 'conv-1',
      worktreePath: 'worktrees/SNPL-101',
      handoffNote: 'Plan: step 1'
    })
  })

  it('resets the agent status to idle on a manual move', async () => {
    const store = await openStore()
    await store.create({ key: 'SNPL-102', title: 'Add test' })
    await store.update('SNPL-102', { agentStatus: 'running' })
    const moved = await store.moveTo('SNPL-102', 'done')
    expect(moved.agentStatus).toBe('idle')
  })

  it('marks running agents interrupted after a restart and leaves the others alone', async () => {
    const store = await openStore()
    await store.create({ key: 'SNPL-103', title: 'A' })
    await store.create({ key: 'SNPL-104', title: 'B' })
    await store.update('SNPL-103', { agentStatus: 'running' })
    await store.update('SNPL-104', { agentStatus: 'paused' })

    const reopened = await openStore()
    expect(await reopened.markRunningInterrupted()).toEqual(['SNPL-103'])
    const final = await openStore()
    expect(final.get('SNPL-103')?.agentStatus).toBe('interrupted')
    expect(final.get('SNPL-104')?.agentStatus).toBe('paused')
  })

  it('rejects keys that could escape the folder and duplicate keys', async () => {
    const store = await openStore()
    await expect(store.create({ key: '../evil-1', title: 'x' })).rejects.toThrow(
      'Invalid ticket key'
    )
    await store.create({ key: 'SNPL-105', title: 'x' })
    await expect(store.create({ key: 'SNPL-105', title: 'y' })).rejects.toThrow('already exists')
  })

  it('reports a corrupt file and still loads the other tickets', async () => {
    const store = await openStore()
    await store.create({ key: 'SNPL-106', title: 'ok' })
    await writeFile(join(directory, 'SNPL-107.json'), '{not json', 'utf-8')

    const reopened = await openStore()
    expect(reopened.list().map((ticket) => ticket.key)).toEqual(['SNPL-106'])
    expect(reopened.getLoadProblems().map((problem) => problem.fileName)).toEqual(['SNPL-107.json'])
  })

  it('deletes the file when a ticket is removed', async () => {
    const store = await openStore()
    await store.create({ key: 'SNPL-108', title: 'gone' })
    await store.remove('SNPL-108')
    expect((await openStore()).list()).toEqual([])
  })
})
