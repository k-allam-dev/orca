// Contract between the ticket runner (src/main/autosfactory/runner/) and the WSL sandbox layer (src/main/autosfactory/sandbox/).
// Decision (#31): one hardened WSL distro, one dedicated non-sudo Linux user per ticket.

import type { EffectivePolicy } from './permission-policy'

export type SandboxSession = {
  ticketKey: string
  linuxUser: string
  homeDir: string
  worktreeDir: string
}

export type AppliedPolicyPaths = {
  claudeSettings: string
  antigravitySettings: string
}

export type SandboxSource = {
  /** Key of a repo in the shared repos folder of the distro (see updateSharedRepo). */
  repoKey: string
  /** The ticket branches from origin/<baseBranch> of the shared repo. */
  baseBranch: string
  /** New branch created in the ticket's own copy. */
  workBranch: string
}

export type UpdateSharedRepoResult = {
  /** Set when the fetch failed and the last copy already in the shared repo was kept. */
  warning: string | null
}

export type TicketSandbox = {
  /** Distro exists, Windows drive mounting and the Windows command bridge are off, and the host firewall rule is applied. Throws with a readable reason when it cannot be made safe. */
  ensureReady(): Promise<void>
  /** Brings the latest base branch of the Windows project into the distro's read-only shared bare repo `<repoKey>.git`. The git login stays on Windows; only a bundle crosses over. A failed fetch keeps the last copy and returns a warning; it throws only when there is no copy yet. */
  updateSharedRepo(repoKey: string, windowsRepoPath: string): Promise<UpdateSharedRepoResult>
  /** Creates the ticket's Linux user and makes a local clone of the shared repo in its home, on a new work branch. Idempotent for an existing session of the same ticket. */
  createSession(ticketKey: string, source: SandboxSource): Promise<SandboxSession>
  /** Kills the ticket user's processes and keeps its files (pause). */
  stopSession(ticketKey: string): Promise<void>
  /** Kills the ticket user's processes and deletes the user and its home (cancel). */
  destroySession(ticketKey: string): Promise<void>
  listSessions(): Promise<SandboxSession[]>
  /** Installs the translated permission files root-owned and unwritable by the ticket user, and returns the paths the launcher passes to the agents' --settings flag. */
  applyPolicy(ticketKey: string, policy: EffectivePolicy): Promise<AppliedPolicyPaths>
}

export type AgentHandle = {
  readonly id: string
  /** Resolves when the agent process ends; `interrupted` is true when it was stopped on purpose. */
  readonly exited: Promise<{ code: number | null; interrupted: boolean }>
  stop(): Promise<void>
}

export type AgentLauncher = {
  start(session: SandboxSession, ticketKey: string): Promise<AgentHandle>
}
