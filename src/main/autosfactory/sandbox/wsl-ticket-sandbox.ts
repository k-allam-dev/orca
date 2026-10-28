import type {
  SandboxSession,
  SandboxSource,
  TicketSandbox
} from '../../../shared/autosfactory/ticket-runner-contract'
import {
  DEFAULT_SANDBOX_DISTRO,
  TICKET_USER_MARKER,
  TICKET_USER_PREFIX
} from '../../../shared/autosfactory/sandbox-config'
import { buildFirewallRuleset, parseDefaultGateway } from './firewall-rule'
import {
  assertBranchName,
  assertRepoUrl,
  assertTicketKey,
  linuxUserForTicket
} from './ticket-user'
import {
  missingWslConfSettings,
  parseWslConf,
  serializeWslConf,
  withRequiredWslConf
} from './wsl-conf'
import type { RunWsl, WslOptions, WslResult } from './wsl-exec'

const BASH = '/bin/bash'
const NFT = '/usr/sbin/nft'
const WSL_CONF_PATH = '/etc/wsl.conf'
const LONG_TIMEOUT_MS = 600_000
const ELEVATED_GROUPS = ['sudo', 'admin', 'wheel', 'root']

export type WslTicketSandboxOptions = {
  runWsl: RunWsl
  distro?: string
  /** Allows ensureReady to apt-get install nftables when it is missing. */
  installNftables?: boolean
}

type PasswdEntry = { name: string; comment: string; home: string }

const CHECK_RUNTIME_SCRIPT = `
if [ -n "$(/usr/bin/ls -A /mnt/c 2>/dev/null)" ]; then echo "/mnt/c is not empty"; exit 21; fi
if /usr/bin/ls /proc/sys/fs/binfmt_misc 2>/dev/null | /usr/bin/grep -qi "^WSLInterop"; then echo "Windows interop is registered"; exit 22; fi
if command -v cmd.exe >/dev/null 2>&1; then echo "cmd.exe is on PATH"; exit 23; fi
exit 0
`

const CLONE_SCRIPT = `
set -eu
repo=$1
branch=$2
key=$3
dir="$HOME/work/$key"
mkdir -p "$HOME/work"
if [ ! -d "$dir/.git" ]; then
  git clone -- "$repo" "$dir"
fi
cd "$dir"
git checkout "$branch" 2>/dev/null || git checkout -b "$branch"
`

function parsePasswdLine(line: string): PasswdEntry | null {
  const fields = line.trim().split(':')
  if (fields.length < 6 || !fields[0]) {
    return null
  }
  return { name: fields[0], comment: fields[4], home: fields[5] }
}

function sessionFor(ticketKey: string, entry: PasswdEntry): SandboxSession {
  return {
    ticketKey,
    linuxUser: entry.name,
    homeDir: entry.home,
    worktreeDir: `${entry.home}/work/${ticketKey}`
  }
}

export class WslTicketSandbox implements TicketSandbox {
  private readonly runWsl: RunWsl
  private readonly distro: string
  private readonly installNftables: boolean

  constructor(options: WslTicketSandboxOptions) {
    this.runWsl = options.runWsl
    this.distro = options.distro ?? DEFAULT_SANDBOX_DISTRO
    this.installNftables = options.installNftables ?? false
  }

  async ensureReady(): Promise<void> {
    await this.assertDistroExists()
    await this.assertWslConf()
    await this.assertRuntimeIsolation()
    await this.applyFirewall()
  }

  async createSession(ticketKey: string, source: SandboxSource): Promise<SandboxSession> {
    assertTicketKey(ticketKey)
    assertRepoUrl(source.repoUrl)
    assertBranchName(source.branch)
    const user = linuxUserForTicket(ticketKey)
    const marker = `${TICKET_USER_MARKER}${ticketKey}`

    let entry = await this.findUser(user)
    if (entry && entry.comment !== marker) {
      throw new Error(`Linux user ${user} already exists and does not belong to ticket ${ticketKey}.`)
    }
    if (!entry) {
      await this.rootMust(
        ['/usr/sbin/useradd', '-m', '-s', BASH, '-c', marker, user],
        `create user ${user}`
      )
      entry = await this.findUser(user)
      if (!entry) {
        throw new Error(`User ${user} was not created.`)
      }
    }
    await this.rootMust(['/usr/bin/chmod', '700', entry.home], `restrict ${entry.home}`)
    await this.assertNotElevated(user)

    await this.mustRun(
      this.bashScript(user, CLONE_SCRIPT, [source.repoUrl, source.branch, ticketKey], {
        timeoutMs: LONG_TIMEOUT_MS
      }),
      `clone into ${user}`
    )
    return sessionFor(ticketKey, entry)
  }

  async stopSession(ticketKey: string): Promise<void> {
    const entry = await this.ownedUser(ticketKey)
    if (entry) {
      await this.killProcesses(entry.name)
    }
  }

  async destroySession(ticketKey: string): Promise<void> {
    const entry = await this.ownedUser(ticketKey)
    if (!entry) {
      return
    }
    await this.killProcesses(entry.name)
    const removed = await this.root(['/usr/sbin/userdel', '-r', entry.name])
    const stillThere = await this.findUser(entry.name)
    const homeLeft = await this.root(['/usr/bin/test', '-e', entry.home])
    if (stillThere || homeLeft.code === 0) {
      throw new Error(
        `Could not delete ${entry.name} (userdel exit ${removed.code}): ${removed.stderr.trim()}`
      )
    }
  }

  async listSessions(): Promise<SandboxSession[]> {
    const result = await this.rootMust(['/usr/bin/getent', 'passwd'], 'list users')
    const sessions: SandboxSession[] = []
    for (const line of result.stdout.split('\n')) {
      const entry = parsePasswdLine(line)
      if (
        entry &&
        entry.name.startsWith(TICKET_USER_PREFIX) &&
        entry.comment.startsWith(TICKET_USER_MARKER)
      ) {
        sessions.push(sessionFor(entry.comment.slice(TICKET_USER_MARKER.length), entry))
      }
    }
    return sessions
  }

  private async assertDistroExists(): Promise<void> {
    const listed = await this.runWsl(['-l', '-q'])
    const names = listed.stdout.split(/\r?\n/).map((name) => name.trim().toLowerCase())
    if (listed.code !== 0 || !names.includes(this.distro.toLowerCase())) {
      throw new Error(
        `WSL distro "${this.distro}" does not exist. Create it first (docs/autosfactory/isolation-research.md, "Creating the sandbox distro").`
      )
    }
  }

  private async assertWslConf(): Promise<void> {
    const current = await this.root(['/usr/bin/cat', WSL_CONF_PATH])
    const conf = parseWslConf(current.code === 0 ? current.stdout : '')
    const missing = missingWslConfSettings(conf)
    if (missing.length === 0) {
      return
    }
    await this.rootMust(['/usr/bin/tee', WSL_CONF_PATH], 'write /etc/wsl.conf', {
      input: serializeWslConf(withRequiredWslConf(conf))
    })
    throw new Error(
      `${WSL_CONF_PATH} in "${this.distro}" was missing ${missing.join(', ')}; it is fixed now, but WSL applies it only after a restart. Run "wsl --terminate ${this.distro}" once, then try again.`
    )
  }

  private async assertRuntimeIsolation(): Promise<void> {
    const check = await this.bashScript('root', CHECK_RUNTIME_SCRIPT, [])
    if (check.code !== 0) {
      const reason = check.stdout.trim() || check.stderr.trim() || 'Windows access is reachable'
      throw new Error(
        `${reason} in "${this.distro}" although wsl.conf disables it. Run "wsl --terminate ${this.distro}" and try again.`
      )
    }
  }

  private async applyFirewall(): Promise<void> {
    const present = await this.root(['/usr/bin/test', '-x', NFT])
    if (present.code !== 0) {
      if (!this.installNftables) {
        throw new Error(
          `nftables is not installed in "${this.distro}". Install it (apt-get install nftables) or enable the install flag.`
        )
      }
      await this.rootMust(['/usr/bin/apt-get', 'install', '-y', 'nftables'], 'install nftables', {
        timeoutMs: LONG_TIMEOUT_MS
      })
    }
    const route = await this.rootMust(
      ['/usr/sbin/ip', 'route', 'show', 'default'],
      'read default gateway'
    )
    const gateway = parseDefaultGateway(route.stdout)
    await this.rootMust([NFT, '-f', '-'], 'apply the firewall rule', {
      input: buildFirewallRuleset(gateway)
    })
    const listed = await this.rootMust(
      [NFT, 'list', 'chain', 'inet', 'fw', 'out'],
      'verify the firewall rule'
    )
    if (!listed.stdout.includes(gateway)) {
      throw new Error(`The firewall rule for ${gateway} is not active in "${this.distro}".`)
    }
  }

  private async assertNotElevated(user: string): Promise<void> {
    const groups = await this.rootMust(['/usr/bin/id', '-nG', user], `read groups of ${user}`)
    const bad = groups.stdout
      .trim()
      .split(/\s+/)
      .filter((group) => ELEVATED_GROUPS.includes(group))
    if (bad.length > 0) {
      throw new Error(`User ${user} is in privileged group(s): ${bad.join(', ')}.`)
    }
  }

  private async killProcesses(user: string): Promise<void> {
    // pkill exits 1 when nothing matched, which is fine
    await this.root(['/usr/bin/pkill', '-KILL', '-u', user])
    for (let attempt = 0; attempt < 5; attempt++) {
      const left = await this.root(['/usr/bin/pgrep', '-u', user])
      if (left.code !== 0) {
        return
      }
      await this.root(['/usr/bin/pkill', '-KILL', '-u', user])
    }
    throw new Error(`Processes of ${user} are still running after kill.`)
  }

  private async ownedUser(ticketKey: string): Promise<PasswdEntry | null> {
    assertTicketKey(ticketKey)
    const entry = await this.findUser(linuxUserForTicket(ticketKey))
    if (entry && entry.comment !== `${TICKET_USER_MARKER}${ticketKey}`) {
      throw new Error(
        `Linux user ${entry.name} does not belong to ticket ${ticketKey}; refusing to touch it.`
      )
    }
    return entry
  }

  private async findUser(user: string): Promise<PasswdEntry | null> {
    const result = await this.root(['/usr/bin/getent', 'passwd', user])
    return result.code === 0 ? parsePasswdLine(result.stdout) : null
  }

  private base(user: string): string[] {
    return ['-d', this.distro, '-u', user, '--exec']
  }

  private root(cmd: string[], opts?: WslOptions): Promise<WslResult> {
    return this.runWsl([...this.base('root'), ...cmd], opts)
  }

  private bashScript(
    user: string,
    script: string,
    args: string[],
    opts: WslOptions = {}
  ): Promise<WslResult> {
    return this.runWsl([...this.base(user), BASH, '-s', '--', ...args], {
      ...opts,
      input: script
    })
  }

  private async rootMust(cmd: string[], what: string, opts?: WslOptions): Promise<WslResult> {
    return this.mustRun(this.root(cmd, opts), what)
  }

  private async mustRun(pending: Promise<WslResult>, what: string): Promise<WslResult> {
    const result = await pending
    if (result.code !== 0) {
      throw new Error(
        `Sandbox step failed (${what}), exit ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`
      )
    }
    return result
  }
}
