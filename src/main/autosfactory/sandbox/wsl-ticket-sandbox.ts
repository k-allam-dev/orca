import type {
  AppliedPolicyPaths,
  SandboxSession,
  SandboxSource,
  TicketSandbox
} from '../../../shared/autosfactory/ticket-runner-contract'
import {
  CLAUDE_MANAGED_SETTINGS_PATH,
  DEFAULT_SANDBOX_DISTRO,
  SHARED_REPOS_DIR,
  SHARED_REPOS_USER,
  TICKET_USER_MARKER,
  TICKET_POLICY_DIR,
  TICKET_USER_PREFIX,
  UPDATE_REPO_SCRIPT_PATH
} from '../../../shared/autosfactory/sandbox-config'
import type { EffectivePolicy } from '../../../shared/autosfactory/permission-policy'
import {
  toAntigravitySettings,
  toClaudeManagedSettings,
  toClaudeTicketSettings
} from '../../../shared/autosfactory/permission-translators'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, win32 } from 'node:path'
import {
  buildFirewallRuleset,
  parseDefaultGateway,
  parseNameservers,
  PRIVATE_IPV4_RANGES
} from './firewall-rule'
import { UPDATE_REPO_SCRIPT } from './update-repo-script'
import { bundleWindowsRepo, type BundleRepo } from './windows-bundle'
import {
  assertBranchName,
  assertRepoKey,
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
const RESOLV_CONF_PATH = '/etc/resolv.conf'
const RESOLVED_CONF_PATH = '/run/systemd/resolve/resolv.conf'
const LONG_TIMEOUT_MS = 600_000
const ELEVATED_GROUPS = ['sudo', 'admin', 'wheel', 'root']

export type WslTicketSandboxOptions = {
  runWsl: RunWsl
  distro?: string
  /** Allows ensureReady to apt-get install nftables when it is missing. */
  installNftables?: boolean
  /** Writes a git bundle of the Windows project's latest base branch to a file. */
  bundleRepo?: BundleRepo
}

type PasswdEntry = { name: string; comment: string; home: string }

const CHECK_RUNTIME_SCRIPT = `
if [ -n "$(/usr/bin/ls -A /mnt/c 2>/dev/null)" ]; then echo "/mnt/c is not empty"; exit 21; fi
if /usr/bin/ls /proc/sys/fs/binfmt_misc 2>/dev/null | /usr/bin/grep -qi "^WSLInterop"; then echo "Windows interop is registered"; exit 22; fi
if command -v cmd.exe >/dev/null 2>&1; then echo "cmd.exe is on PATH"; exit 23; fi
exit 0
`

// args: <shared bare repo> <base branch> <work branch> <ticket key>
const CLONE_SCRIPT = `
set -eu
repo=$1
base=$2
work=$3
key=$4
dir="$HOME/work/$key"
mkdir -p "$HOME/work"
if [ ! -d "$dir/.git" ]; then
  rm -rf "$dir"
  git clone --local --no-hardlinks --no-checkout -q -- "$repo" "$dir" || { rm -rf "$dir"; exit 1; }
  cd "$dir"
  git checkout -q -b "$work" "origin/$base"
else
  cd "$dir"
  git checkout -q "$work" 2>/dev/null || git checkout -q -b "$work" "origin/$base"
fi
`

// args: <repos dir> <repos user> <update script path>; idempotent, run as root.
const PREPARE_SHARED_REPOS_SCRIPT = `
set -eu
dir=$1
owner=$2
script=$3
if ! /usr/bin/getent passwd "$owner" >/dev/null; then
  /usr/sbin/useradd -m -s /bin/bash "$owner"
fi
/usr/bin/chmod 700 "$(/usr/bin/getent passwd "$owner" | /usr/bin/cut -d: -f6)"
/usr/bin/mkdir -p "$dir"
/usr/bin/chown "$owner:$owner" "$dir"
/usr/bin/chmod 755 "$dir"
if ! /usr/bin/git config --system --get-all safe.directory | /usr/bin/grep -qxF "$dir/*"; then
  /usr/bin/git config --system --add safe.directory "$dir/*"
fi
/usr/bin/mkdir -p "$(/usr/bin/dirname "$script")"
/usr/bin/cat > "$script" <<'AF_UPDATE_SCRIPT_END'
${UPDATE_REPO_SCRIPT}AF_UPDATE_SCRIPT_END
/usr/bin/chown root:root "$script"
/usr/bin/chmod 755 "$script"
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
  private readonly bundleRepo: BundleRepo

  constructor(options: WslTicketSandboxOptions) {
    this.runWsl = options.runWsl
    this.distro = options.distro ?? DEFAULT_SANDBOX_DISTRO
    this.installNftables = options.installNftables ?? false
    this.bundleRepo = options.bundleRepo ?? bundleWindowsRepo
  }

  async ensureReady(): Promise<void> {
    await this.assertDistroExists()
    await this.assertWslConf()
    await this.assertRuntimeIsolation()
    await this.applyFirewall()
    await this.prepareSharedRepos()
  }

  async updateSharedRepo(repoKey: string, windowsRepoPath: string): Promise<void> {
    assertRepoKey(repoKey)
    if (!windowsRepoPath.trim() || !(isAbsolute(windowsRepoPath) || win32.isAbsolute(windowsRepoPath))) {
      throw new Error(`The project path must be absolute: ${JSON.stringify(windowsRepoPath)}`)
    }
    const tempDir = await mkdtemp(join(tmpdir(), 'autosfactory-bundle-'))
    try {
      const bundleFile = join(tempDir, `${repoKey}.bundle`)
      await this.bundleRepo(windowsRepoPath, bundleFile)
      await this.mustRun(
        this.runWsl(
          [
            ...this.base(SHARED_REPOS_USER),
            BASH,
            UPDATE_REPO_SCRIPT_PATH,
            SHARED_REPOS_DIR,
            repoKey
          ],
          { inputFile: bundleFile, timeoutMs: LONG_TIMEOUT_MS }
        ),
        `update shared repo ${repoKey}`
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  async createSession(ticketKey: string, source: SandboxSource): Promise<SandboxSession> {
    assertTicketKey(ticketKey)
    assertRepoKey(source.repoKey)
    assertBranchName(source.baseBranch)
    assertBranchName(source.workBranch)
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

    const repoPath = `${SHARED_REPOS_DIR}/${source.repoKey}.git`
    const loaded = await this.root(['/usr/bin/test', '-d', repoPath])
    if (loaded.code !== 0) {
      throw new Error(
        `Shared repo ${source.repoKey} is not loaded in "${this.distro}"; call updateSharedRepo first.`
      )
    }
    await this.mustRun(
      this.bashScript(
        user,
        CLONE_SCRIPT,
        [repoPath, source.baseBranch, source.workBranch, ticketKey],
        { timeoutMs: LONG_TIMEOUT_MS }
      ),
      `clone into ${user}`
    )
    return sessionFor(ticketKey, entry)
  }

  async applyPolicy(ticketKey: string, policy: EffectivePolicy): Promise<AppliedPolicyPaths> {
    assertTicketKey(ticketKey)
    const dir = `${TICKET_POLICY_DIR}/${ticketKey}`
    const paths = { claudeSettings: `${dir}/claude-settings.json`, antigravitySettings: `${dir}/antigravity-settings.json` }
    const files: [string, unknown][] = [
      [CLAUDE_MANAGED_SETTINGS_PATH, toClaudeManagedSettings(policy.global)],
      [paths.claudeSettings, toClaudeTicketSettings(policy)],
      [paths.antigravitySettings, toAntigravitySettings(policy).settings]
    ]
    await this.rootMust(['/usr/bin/mkdir', '-p', '/etc/claude-code', dir], 'create the policy folders')
    for (const [path, content] of files) {
      await this.rootMust(['/usr/bin/tee', path], `write ${path}`, { input: JSON.stringify(content, null, 2) + String.fromCharCode(10) })
    }
    const paths644 = files.map(([path]) => path)
    await this.rootMust(['/usr/bin/chown', 'root:root', '/etc/claude-code', dir, ...paths644], 'own the policy files as root')
    await this.rootMust(['/usr/bin/chmod', '755', '/etc/claude-code', dir], 'set policy folder modes')
    await this.rootMust(['/usr/bin/chmod', '644', ...paths644], 'set policy file modes')
    return paths
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
    await this.root(['/usr/bin/rm', '-rf', `${TICKET_POLICY_DIR}/${ticketKey}`])
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
    const nameservers = await this.readNameservers()
    await this.rootMust([NFT, '-f', '-'], 'apply the firewall rule', {
      input: buildFirewallRuleset(gateway, nameservers)
    })
    const listed = await this.rootMust(
      [NFT, 'list', 'chain', 'inet', 'fw', 'out'],
      'verify the firewall rule'
    )
    // Why: nft merges the gateway into a covering private range when listing, so check the ranges.
    if (!listed.stdout.includes('reject') || !listed.stdout.includes(PRIVATE_IPV4_RANGES[2])) {
      throw new Error(`The firewall rule for ${gateway} is not active in "${this.distro}".`)
    }
  }

  private async readNameservers(): Promise<string[]> {
    const primary = await this.rootMust(['/usr/bin/cat', RESOLV_CONF_PATH], 'read resolv.conf')
    // Why: with a systemd-resolved stub the real upstream resolvers are listed only here.
    const upstream = await this.root(['/usr/bin/cat', RESOLVED_CONF_PATH])
    return parseNameservers(`${primary.stdout}
${upstream.code === 0 ? upstream.stdout : ''}`)
  }

  private async prepareSharedRepos(): Promise<void> {
    await this.mustRun(
      this.bashScript('root', PREPARE_SHARED_REPOS_SCRIPT, [
        SHARED_REPOS_DIR,
        SHARED_REPOS_USER,
        UPDATE_REPO_SCRIPT_PATH
      ]),
      'prepare the shared repos folder'
    )
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
