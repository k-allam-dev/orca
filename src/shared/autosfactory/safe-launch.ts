export type SafeLaunchOptions = {
  /** Root-owned settings file written by the sandbox policy step. */
  settingsPath?: string
  model?: string
  /** Extra arguments; anything that skips or relaxes permissions is rejected. */
  extraArgs?: string[]
}

const CLAUDE_FORBIDDEN = [
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  '--permission-mode',
  '--permission-prompt-tool',
  '--permission-prompts',
  '--allowedTools',
  '--allowed-tools',
  '--settings'
] as const

const ANTIGRAVITY_FORBIDDEN = [
  '--dangerously-skip-permissions',
  '--mode',
  '--settings',
  '--sandbox'
] as const

function flagName(arg: string): string {
  const equals = arg.indexOf('=')
  return equals === -1 ? arg : arg.slice(0, equals)
}

function assertAllowed(extraArgs: string[], forbidden: readonly string[], agent: string): void {
  for (const arg of extraArgs) {
    if (forbidden.includes(flagName(arg))) {
      throw new Error(`Launch argument ${arg} is not allowed for ${agent} tickets: the policy sets permissions.`)
    }
  }
}

export function buildClaudeLaunchArgs(options: SafeLaunchOptions = {}): string[] {
  const extra = options.extraArgs ?? []
  assertAllowed(extra, CLAUDE_FORBIDDEN, 'Claude')
  return [
    '--permission-mode',
    'default',
    ...(options.settingsPath ? ['--settings', options.settingsPath] : []),
    ...(options.model ? ['--model', options.model] : []),
    ...extra
  ]
}

export function buildAntigravityLaunchArgs(options: SafeLaunchOptions = {}): string[] {
  const extra = options.extraArgs ?? []
  assertAllowed(extra, ANTIGRAVITY_FORBIDDEN, 'Antigravity')
  return [
    ...(options.settingsPath ? ['--settings', options.settingsPath] : []),
    ...(options.model ? ['--model', options.model] : []),
    ...extra
  ]
}

export function launchArgsRelaxPermissions(args: string[]): boolean {
  return args.some((arg, index) => {
    const name = flagName(arg)
    if (/^--(allow-)?dangerously-skip-permissions$/.test(name) || name === '--mode') {
      return true
    }
    if (name === '--permission-mode') {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[index + 1]
      return value !== 'default'
    }
    return false
  })
}
