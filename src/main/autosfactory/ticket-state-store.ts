import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'
import {
  TICKET_RECORD_VERSION,
  isTicketKey,
  parseTicketRecord,
  type TicketRecord,
  type TicketRecordPatch,
  type TicketState
} from '../../shared/autosfactory/ticket-state'

export type TicketLoadProblem = { fileName: string; reason: string }

export class TicketStateStore {
  private readonly tickets = new Map<string, TicketRecord>()
  private readonly writeQueues = new Map<string, Promise<void>>()
  private loadProblems: TicketLoadProblem[] = []

  constructor(
    private readonly directory: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    this.tickets.clear()
    this.loadProblems = []
    for (const fileName of await readdir(this.directory)) {
      if (!fileName.endsWith('.json')) {
        continue
      }
      const record = await this.readRecord(fileName)
      if (record) {
        this.tickets.set(record.key, record)
      }
    }
  }

  getLoadProblems(): readonly TicketLoadProblem[] {
    return this.loadProblems
  }

  list(): TicketRecord[] {
    return [...this.tickets.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  get(key: string): TicketRecord | null {
    return this.tickets.get(key) ?? null
  }

  async create(input: { key: string; title: string }): Promise<TicketRecord> {
    if (!isTicketKey(input.key)) {
      throw new Error(`Invalid ticket key: ${input.key}`)
    }
    if (this.tickets.has(input.key)) {
      throw new Error(`Ticket already exists: ${input.key}`)
    }
    const timestamp = this.now().toISOString()
    const record: TicketRecord = {
      version: TICKET_RECORD_VERSION,
      key: input.key,
      title: input.title,
      state: 'new',
      agentStatus: 'idle',
      agent: null,
      conversationId: null,
      worktreePath: null,
      repoId: null,
      handoffNote: '',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await this.save(record)
    return record
  }

  // Why: a manual move may skip any state, and it always stops the agent, so the status resets.
  async moveTo(key: string, state: TicketState): Promise<TicketRecord> {
    return this.save({ ...this.require(key), state, agentStatus: 'idle' })
  }

  async update(key: string, patch: TicketRecordPatch): Promise<TicketRecord> {
    return this.save({ ...this.require(key), ...patch })
  }

  async remove(key: string): Promise<void> {
    this.require(key)
    this.tickets.delete(key)
    await this.enqueue(key, () => rm(this.pathFor(key), { force: true }))
  }

  // Why: nothing resumes on its own after a restart; the user restarts each agent one at a time.
  async markRunningInterrupted(): Promise<string[]> {
    const interrupted: string[] = []
    for (const record of this.tickets.values()) {
      if (record.agentStatus === 'running') {
        await this.save({ ...record, agentStatus: 'interrupted' })
        interrupted.push(record.key)
      }
    }
    return interrupted
  }

  private require(key: string): TicketRecord {
    const record = this.tickets.get(key)
    if (!record) {
      throw new Error(`Unknown ticket: ${key}`)
    }
    return record
  }

  private pathFor(key: string): string {
    return join(this.directory, `${key}.json`)
  }

  private async save(record: TicketRecord): Promise<TicketRecord> {
    const next = { ...record, updatedAt: this.now().toISOString() }
    this.tickets.set(next.key, next)
    const finalPath = this.pathFor(next.key)
    await this.enqueue(next.key, () =>
      writeFileDurable(
        durableWriteTempPath(finalPath),
        finalPath,
        `${JSON.stringify(next, null, 2)}\n`
      )
    )
    return next
  }

  // Why: concurrent writes to one ticket must land in call order, so the last change wins on disk.
  private enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(key) ?? Promise.resolve()
    const run = previous.catch(() => {}).then(task)
    this.writeQueues.set(key, run)
    return run
  }

  private async readRecord(fileName: string): Promise<TicketRecord | null> {
    try {
      const parsed = parseTicketRecord(
        JSON.parse(await readFile(join(this.directory, fileName), 'utf-8'))
      )
      if (!parsed || `${parsed.key}.json` !== fileName) {
        this.loadProblems.push({ fileName, reason: 'Not a valid ticket record' })
        return null
      }
      return parsed
    } catch (error) {
      this.loadProblems.push({
        fileName,
        reason: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }
}
