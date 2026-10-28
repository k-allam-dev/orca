import type {
  JiraAlert,
  JiraSyncResult,
  JiraSyncStatus
} from '../../shared/autosfactory/jira-intake'
import type { RunnerStartResult, RunnerStatus } from '../../shared/autosfactory/ticket-runner'
import type {
  TicketRecord,
  TicketRecordPatch,
  TicketState
} from '../../shared/autosfactory/ticket-state'

export type AutosfactoryApi = {
  listTickets: () => Promise<TicketRecord[]>
  createTicket: (args: { key: string; title: string }) => Promise<TicketRecord>
  moveTicket: (args: { key: string; state: TicketState }) => Promise<TicketRecord>
  updateTicket: (args: { key: string; patch: TicketRecordPatch }) => Promise<TicketRecord>
  removeTicket: (args: { key: string }) => Promise<void>
  runnerStart: (args: { key: string }) => Promise<RunnerStartResult>
  runnerPause: (args: { key: string }) => Promise<void>
  runnerCancel: (args: { key: string; confirmed: boolean }) => Promise<void>
  runnerStatus: () => Promise<RunnerStatus>
  syncNow: () => Promise<JiraSyncResult>
  getSyncStatus: () => Promise<JiraSyncStatus>
  listJiraStatuses: () => Promise<Record<string, string>>
  listAlerts: () => Promise<JiraAlert[]>
  dismissAlert: (args: { id: string }) => Promise<void>
}
