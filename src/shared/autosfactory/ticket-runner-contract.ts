// Contract between the ticket runner (src/main/autosfactory/runner/) and the WSL sandbox layer (src/main/autosfactory/sandbox/).
// Decision (#31): one hardened WSL distro, one dedicated non-sudo Linux user per ticket.

export type SandboxSession = {
  ticketKey: string
  linuxUser: string
  homeDir: string
  worktreeDir: string
}

export type SandboxSource = {
  /** Key of a repo in the shared repos folder of the distro (see updateSharedRepo). */
  repoKey: string
  /** The ticket branches from origin/<baseBranch> of the shared repo. */
  baseBranch: string
  /** New branch created in the ticket's own copy. */
  workBranch: string
}

export type TicketSandbox = {
  /** Distro exists, Windows drive mounting and the Windows command bridge are off, and the host firewall rule is applied. Throws with a readable reason when it cannot be made safe. */
  ensureReady(): Promise<void>
  /** Brings the latest base branch of the Windows project into the distro's read-only shared bare repo `<repoKey>.git`. The git login stays on Windows; only a bundle crosses over. */
  updateSharedRepo(repoKey: string, windowsRepoPath: string): Promise<void>
  /** Creates the ticket's Linux user and makes a local clone of the shared repo in its home, on a new work branch. Idempotent for an existing session of the same ticket. */
  createSession(ticketKey: string, source: SandboxSource): Promise<SandboxSession>
  /** Kills the ticket user's processes and keeps its files (pause). */
  stopSession(ticketKey: string): Promise<void>
  /** Kills the ticket user's processes and deletes the user and its home (cancel). */
  destroySession(ticketKey: string): Promise<void>
  listSessions(): Promise<SandboxSession[]>
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
