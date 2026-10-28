export const TICKET_FLAGS = ['permissionRequest', 'jiraChanged', 'usageLimit', 'queued'] as const
export type TicketFlag = (typeof TICKET_FLAGS)[number]

export type TicketFlags = Readonly<Partial<Record<TicketFlag, boolean>>>
