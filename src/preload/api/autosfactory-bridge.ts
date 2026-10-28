import { ipcRenderer } from 'electron'
import type { AutosfactoryApi } from './autosfactory-api'

export const autosfactoryApi: AutosfactoryApi = {
  listTickets: () => ipcRenderer.invoke('autosfactory:tickets:list'),
  createTicket: (args) => ipcRenderer.invoke('autosfactory:tickets:create', args),
  moveTicket: (args) => ipcRenderer.invoke('autosfactory:tickets:move', args),
  updateTicket: (args) => ipcRenderer.invoke('autosfactory:tickets:update', args),
  removeTicket: (args) => ipcRenderer.invoke('autosfactory:tickets:remove', args),
  syncNow: () => ipcRenderer.invoke('autosfactory:jira:sync-now'),
  getSyncStatus: () => ipcRenderer.invoke('autosfactory:jira:status'),
  listJiraStatuses: () => ipcRenderer.invoke('autosfactory:jira:statuses'),
  listAlerts: () => ipcRenderer.invoke('autosfactory:jira:alerts'),
  dismissAlert: (args) => ipcRenderer.invoke('autosfactory:jira:dismiss-alert', args)
}
