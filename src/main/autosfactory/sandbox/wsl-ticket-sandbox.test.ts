import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { buildFirewallRuleset, parseDefaultGateway, parseNameservers } from './firewall-rule'
import { assertRepoKey, linuxUserForTicket } from './ticket-user'
import { parseWslConf, missingWslConfSettings } from './wsl-conf'
import { decodeWslOutput } from './wsl-exec'
import type { RunWsl, WslOptions, WslResult } from './wsl-exec'
import { WslTicketSandbox } from './wsl-ticket-sandbox'
import { baselineRules, effectivePolicy } from '../../../shared/autosfactory/permission-policy'

const GOOD_CONF =
  '[automount]\nenabled=false\nmountFsTab=false\n[interop]\nenabled=false\nappendWindowsPath=false\n'

type Call = { user: string; cmd: string[]; opts?: WslOptions }

type FakeWorld = {
  distros: string[]
  wslConf: string
  users: Map<string, { comment: string; groups: string }>
  hasNft: boolean
  route: string
  runtimeCheckCode: number
  calls: Call[]
  nftInput: string[]
  loadedRepos: string[]
}

function ok(stdout = ''): WslResult {
  return { code: 0, stdout, stderr: '' }
}
function fail(code = 1, stderr = ''): WslResult {
  return { code, stdout: '', stderr }
}

function makeWorld(): FakeWorld {
  return {
    distros: ['Ubuntu', 'autosfactory'],
    wslConf: GOOD_CONF,
    users: new Map(),
    hasNft: true,
    route: 'default via 172.30.192.1 dev eth0 proto kernel\n',
    runtimeCheckCode: 0,
    calls: [],
    nftInput: [],
    loadedRepos: ['/srv/autosfactory/repos/orca.git']
  }
}

function makeFake(world: FakeWorld): RunWsl {
  return async (args, opts) => {
    if (args[0] === '-l') {
      return ok(world.distros.join('\r\n'))
    }
    const user = args[args.indexOf('-u') + 1]
    const cmd = args.slice(args.indexOf('--exec') + 1)
    world.calls.push({ user, cmd, opts })
    const [bin, ...rest] = cmd
    switch (bin) {
      case '/usr/bin/cat':
        if (rest[0] === '/etc/resolv.conf') {
          return ok('# generated\nnameserver 10.255.255.254\n')
        }
        if (rest[0] !== '/etc/wsl.conf') {
          return fail()
        }
        return world.wslConf ? ok(world.wslConf) : fail()
      case '/usr/bin/tee':
        world.wslConf = opts?.input ?? ''
        return ok()
      case '/bin/bash':
        if (user === 'root') {
          return world.runtimeCheckCode === 0
            ? ok()
            : { code: world.runtimeCheckCode, stdout: '/mnt/c is not empty', stderr: '' }
        }
        return ok()
      case '/usr/bin/test':
        if (rest[0] === '-x') {
          return world.hasNft ? ok() : fail()
        }
        if (rest[0] === '-d') {
          return world.loadedRepos.includes(rest[1]) ? ok() : fail()
        }
        return fail()
      case '/usr/bin/apt-get':
        world.hasNft = true
        return ok()
      case '/usr/sbin/ip':
        return ok(world.route)
      case '/usr/sbin/nft':
        if (rest[0] === '-f') {
          world.nftInput.push(opts?.input ?? '')
          return ok()
        }
        return ok(world.nftInput.at(-1) ?? '')
      case '/usr/bin/getent': {
        if (rest.length === 2) {
          return fail(2)
        }
        const lines = [...world.users].map(
          ([name, u]) => `${name}:x:1:1:${u.comment}:/home/${name}:/bin/bash`
        )
        return ok(`root:x:0:0:root:/root:/bin/bash\n${lines.join('\n')}\n`)
      }
      case '/usr/sbin/useradd': {
        world.users.set(rest.at(-1) ?? '', { comment: rest[rest.indexOf('-c') + 1], groups: 'x' })
        return ok()
      }
      case '/usr/bin/id':
        return ok(world.users.get(rest[1])?.groups ?? '')
      case '/usr/sbin/userdel':
        world.users.delete(rest[1])
        return ok()
      case '/usr/bin/pgrep':
        return fail()
      default:
        return ok()
    }
  }
}

function withGetentLookup(world: FakeWorld): RunWsl {
  const inner = makeFake(world)
  return async (args, opts) => {
    const cmd = args.slice(args.indexOf('--exec') + 1)
    if (cmd[0] === '/usr/bin/getent' && cmd.length === 3) {
      const name = cmd[2]
      const found = world.users.get(name)
      world.calls.push({ user: 'root', cmd })
      return found ? ok(`${name}:x:1:1:${found.comment}:/home/${name}:/bin/bash\n`) : fail(2)
    }
    return inner(args, opts)
  }
}

const SOURCE = { repoKey: 'orca', baseBranch: 'develop', workBranch: 'autosfactory/SNPL-12' }

describe('ticket user derivation', () => {
  it('derives lowercase names and keeps long ones within 32 chars and unique', () => {
    expect(linuxUserForTicket('SNPL-12')).toBe('t-snpl-12')
    const a = linuxUserForTicket(`${'A'.repeat(40)}-1`)
    const b = linuxUserForTicket(`${'A'.repeat(40)}-2`)
    expect(a.length).toBeLessThanOrEqual(32)
    expect(a).not.toBe(b)
  })

  it('rejects hostile keys', () => {
    for (const key of [
      '../x-1',
      'SNPL 12',
      'SNPL-1"',
      'SNPL-1;id',
      'snpl-1',
      'SNPL-',
      '',
      'A-1\n'
    ]) {
      expect(() => linuxUserForTicket(key), key).toThrow()
    }
  })
})

describe('firewall and conf helpers', () => {
  it('reads the gateway and builds an idempotent ruleset from it', () => {
    const gateway = parseDefaultGateway('default via 10.1.2.3 dev eth0\n')
    const rules = buildFirewallRuleset(gateway)
    expect(rules).toContain('10.1.2.3')
    for (const range of [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '169.254.0.0/16',
      '100.64.0.0/10'
    ]) {
      expect(rules).toContain(range)
    }
    expect(rules.indexOf('add table inet fw')).toBeLessThan(rules.indexOf('delete table inet fw'))
  })

  it('accepts DNS to the nameservers before rejecting the private ranges', () => {
    const rules = buildFirewallRuleset('172.30.192.1', ['10.255.255.254', 'fd00::1'])
    expect(rules).toContain(
      'ip daddr { 10.255.255.254 } meta l4proto { udp, tcp } th dport 53 accept'
    )
    expect(rules).toContain('ip6 daddr { fd00::1 }')
    expect(rules.indexOf('th dport 53 accept')).toBeLessThan(rules.indexOf('reject'))
    expect(rules.indexOf('oifname "lo" accept')).toBeLessThan(rules.indexOf('th dport 53'))
    expect(() => buildFirewallRuleset('172.30.192.1', ['1.1.1.1; flush ruleset'])).toThrow()
  })

  it('reads nameservers from resolv.conf text', () => {
    const text =
      '# x\nnameserver 10.255.255.254\nnameserver fe80::1%eth0\nnameserver nope\nnameserver 10.255.255.254\n'
    expect(parseNameservers(text)).toEqual(['10.255.255.254', 'fe80::1'])
  })

  it('validates repo keys strictly', () => {
    expect(() => assertRepoKey('orca')).not.toThrow()
    expect(() => assertRepoKey('my-repo_2.x')).not.toThrow()
    for (const key of [
      '',
      '../x',
      'a/b',
      'a b',
      '-rf',
      '.hidden',
      'a..b',
      'x.git',
      'x.lock',
      'a;id',
      'a\n',
      'a\\b'
    ]) {
      expect(() => assertRepoKey(key), key).toThrow()
    }
  })

  it('refuses a missing or odd gateway', () => {
    expect(() => parseDefaultGateway('')).toThrow()
    expect(() => buildFirewallRuleset('1.2.3.4; reboot')).toThrow()
  })

  it('detects missing wsl.conf settings', () => {
    expect(missingWslConfSettings(parseWslConf(GOOD_CONF))).toEqual([])
    expect(missingWslConfSettings(parseWslConf('[interop]\nenabled=false\n'))).toHaveLength(3)
  })

  it('decodes UTF-16 output from wsl.exe', () => {
    const text = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Ubuntu\r\n', 'utf16le')])
    expect(decodeWslOutput(text)).toBe('Ubuntu\r\n')
    expect(decodeWslOutput(Buffer.from('plain', 'utf8'))).toBe('plain')
  })
})

describe('WslTicketSandbox.ensureReady', () => {
  it('applies the firewall rule from the real gateway, repeatedly', async () => {
    const world = makeWorld()
    const sandbox = new WslTicketSandbox({ runWsl: makeFake(world) })
    await sandbox.ensureReady()
    await sandbox.ensureReady()
    expect(world.nftInput).toHaveLength(2)
    expect(world.nftInput[0]).toContain('172.30.192.1')
    expect(world.nftInput[0]).toContain('10.255.255.254')
    expect(world.nftInput[0]).toBe(world.nftInput[1])
  })

  it('prepares the shared repos folder, safe.directory and the update script as root', async () => {
    const world = makeWorld()
    await new WslTicketSandbox({ runWsl: makeFake(world) }).ensureReady()
    const prepare = world.calls
      .filter((call) => call.user === 'root' && call.cmd[0] === '/bin/bash')
      .at(-1)
    expect(prepare?.cmd.slice(-3)).toEqual([
      '/srv/autosfactory/repos',
      'afrepos',
      '/usr/local/lib/autosfactory/update-repo.sh'
    ])
    expect(prepare?.opts?.input).toContain('safe.directory')
    expect(prepare?.opts?.input).toContain('git init --bare')
    expect(prepare?.opts?.input).toContain('chown root:root')
  })

  it('fails when the distro is missing', async () => {
    const world = makeWorld()
    world.distros = ['Ubuntu']
    await expect(new WslTicketSandbox({ runWsl: makeFake(world) }).ensureReady()).rejects.toThrow(
      /does not exist/
    )
  })

  it('writes wsl.conf and asks for one terminate when settings are missing', async () => {
    const world = makeWorld()
    world.wslConf = '[boot]\nsystemd=true\n'
    const sandbox = new WslTicketSandbox({ runWsl: makeFake(world), distro: 'autosfactory' })
    await expect(sandbox.ensureReady()).rejects.toThrow(/wsl --terminate autosfactory/)
    expect(world.wslConf).toContain('systemd=true')
    expect(missingWslConfSettings(parseWslConf(world.wslConf))).toEqual([])
    expect(world.nftInput).toHaveLength(0)
  })

  it('fails when Windows is still reachable at runtime', async () => {
    const world = makeWorld()
    world.runtimeCheckCode = 21
    await expect(new WslTicketSandbox({ runWsl: makeFake(world) }).ensureReady()).rejects.toThrow(
      /\/mnt\/c is not empty/
    )
    expect(world.nftInput).toHaveLength(0)
  })

  it('throws without nftables unless the install flag is set', async () => {
    const world = makeWorld()
    world.hasNft = false
    await expect(new WslTicketSandbox({ runWsl: makeFake(world) }).ensureReady()).rejects.toThrow(
      /nftables is not installed/
    )
    await new WslTicketSandbox({ runWsl: makeFake(world), installNftables: true }).ensureReady()
    expect(world.nftInput).toHaveLength(1)
  })
})

describe('WslTicketSandbox sessions', () => {
  it('creates a user with a private home and clones as that user with positional args', async () => {
    const world = makeWorld()
    const sandbox = new WslTicketSandbox({ runWsl: withGetentLookup(world) })
    const session = await sandbox.createSession('SNPL-12', SOURCE)
    expect(session).toEqual({
      ticketKey: 'SNPL-12',
      linuxUser: 't-snpl-12',
      homeDir: '/home/t-snpl-12',
      worktreeDir: '/home/t-snpl-12/work/SNPL-12'
    })
    const useradd = world.calls.find((call) => call.cmd[0] === '/usr/sbin/useradd')
    expect(useradd?.cmd).toContain('-m')
    expect(
      world.calls.some((call) => call.cmd[0] === '/usr/bin/chmod' && call.cmd[1] === '700')
    ).toBe(true)
    const clone = world.calls.find((call) => call.user === 't-snpl-12')
    expect(clone?.cmd).toEqual([
      '/bin/bash',
      '-s',
      '--',
      '/srv/autosfactory/repos/orca.git',
      'develop',
      'autosfactory/SNPL-12',
      'SNPL-12'
    ])
    expect(clone?.opts?.input).not.toContain(SOURCE.workBranch)
    expect(clone?.opts?.input).toContain('--local')
  })

  it('is idempotent for an existing session', async () => {
    const world = makeWorld()
    const sandbox = new WslTicketSandbox({ runWsl: withGetentLookup(world) })
    const first = await sandbox.createSession('SNPL-12', SOURCE)
    const second = await sandbox.createSession('SNPL-12', SOURCE)
    expect(second).toEqual(first)
    expect(world.calls.filter((call) => call.cmd[0] === '/usr/sbin/useradd')).toHaveLength(1)
  })

  it('refuses a user that belongs to someone else and a privileged user', async () => {
    const world = makeWorld()
    world.users.set('t-snpl-12', { comment: 'somebody', groups: 'x' })
    const sandbox = new WslTicketSandbox({ runWsl: withGetentLookup(world) })
    await expect(sandbox.createSession('SNPL-12', SOURCE)).rejects.toThrow(/does not belong/)
    world.users.set('t-snpl-13', { comment: 'af-ticket=SNPL-13', groups: 'x sudo' })
    await expect(sandbox.createSession('SNPL-13', SOURCE)).rejects.toThrow(/privileged/)
  })

  it('rejects bad input before touching WSL', async () => {
    const world = makeWorld()
    const sandbox = new WslTicketSandbox({ runWsl: withGetentLookup(world) })
    await expect(sandbox.createSession('../x-1', SOURCE)).rejects.toThrow()
    await expect(
      sandbox.createSession('SNPL-1', { ...SOURCE, repoKey: '../orca' })
    ).rejects.toThrow()
    await expect(
      sandbox.createSession('SNPL-1', { ...SOURCE, workBranch: 'a b' })
    ).rejects.toThrow()
    await expect(
      sandbox.createSession('SNPL-1', { ...SOURCE, baseBranch: '../x' })
    ).rejects.toThrow()
    expect(world.calls).toHaveLength(0)
  })

  it('asks for updateSharedRepo when the shared repo is not loaded', async () => {
    const world = makeWorld()
    world.loadedRepos = []
    const sandbox = new WslTicketSandbox({ runWsl: withGetentLookup(world) })
    await expect(sandbox.createSession('SNPL-12', SOURCE)).rejects.toThrow(/updateSharedRepo/)
    expect(
      world.calls.some((call) => call.user === 't-snpl-12' && call.cmd[0] === '/bin/bash')
    ).toBe(false)
  })

  it('stop kills processes and keeps the user; destroy removes it; list shows sessions', async () => {
    const world = makeWorld()
    world.users.set('tkt1', { comment: '', groups: 'tkt1' })
    const sandbox = new WslTicketSandbox({ runWsl: withGetentLookup(world) })
    await sandbox.createSession('SNPL-12', SOURCE)
    expect((await sandbox.listSessions()).map((s) => s.ticketKey)).toEqual(['SNPL-12'])

    await sandbox.stopSession('SNPL-12')
    expect(world.calls.some((call) => call.cmd[0] === '/usr/bin/pkill')).toBe(true)
    expect(world.users.has('t-snpl-12')).toBe(true)

    await sandbox.destroySession('SNPL-12')
    expect(world.users.has('t-snpl-12')).toBe(false)
    expect(world.users.has('tkt1')).toBe(true)
    await expect(sandbox.destroySession('SNPL-12')).resolves.toBeUndefined()
  })
})

describe('WslTicketSandbox.updateSharedRepo', () => {
  it('bundles the Windows project and streams the file into the distro as afrepos', async () => {
    const world = makeWorld()
    const bundled: string[][] = []
    const sandbox = new WslTicketSandbox({
      runWsl: makeFake(world),
      fetchRepo: async () => undefined,
      bundleRepo: async (path, file) => void bundled.push([path, file])
    })
    await sandbox.updateSharedRepo('orca', 'C:\\Users\\k\\orca')
    expect(bundled).toHaveLength(1)
    expect(bundled[0][0]).toBe('C:\\Users\\k\\orca')
    const call = world.calls.at(-1)
    expect(call?.user).toBe('afrepos')
    expect(call?.cmd).toEqual([
      '/bin/bash',
      '/usr/local/lib/autosfactory/update-repo.sh',
      '/srv/autosfactory/repos',
      'orca'
    ])
    expect(call?.opts?.inputFile).toBe(bundled[0][1])
    expect(existsSync(bundled[0][1])).toBe(false)
  })

  it('removes the temp bundle even when the distro step fails', async () => {
    let file = ''
    const failing: RunWsl = async () => fail(1, 'fetch broke')
    const sandbox = new WslTicketSandbox({
      runWsl: failing,
      fetchRepo: async () => undefined,
      bundleRepo: async (_path, target) => {
        file = target
        await writeFile(target, 'x')
      }
    })
    await expect(sandbox.updateSharedRepo('orca', 'C:\\p')).rejects.toThrow(/fetch broke/)
    expect(existsSync(file)).toBe(false)
  })

  it('keeps the last copy and returns a warning when the fetch fails', async () => {
    const world = makeWorld()
    let bundled = false
    const sandbox = new WslTicketSandbox({
      runWsl: makeFake(world),
      fetchRepo: async () => {
        throw new Error('origin is gone')
      },
      bundleRepo: async () => void (bundled = true)
    })
    const result = await sandbox.updateSharedRepo('orca', 'C:\\p')
    expect(result.warning).toMatch(/Could not fetch orca.*last copy.*origin is gone/)
    expect(bundled).toBe(false)
  })

  it('fails when the fetch fails and no shared copy exists yet', async () => {
    const missing: RunWsl = async () => fail(1, '')
    const sandbox = new WslTicketSandbox({
      runWsl: missing,
      fetchRepo: async () => {
        throw new Error('origin is gone')
      },
      bundleRepo: async () => undefined
    })
    await expect(sandbox.updateSharedRepo('orca', 'C:\\p')).rejects.toThrow(
      /no earlier copy exists: origin is gone/
    )
  })

  it('rejects bad repo keys and relative paths before doing anything', async () => {
    const world = makeWorld()
    let called = false
    const sandbox = new WslTicketSandbox({
      runWsl: makeFake(world),
      fetchRepo: async () => undefined,
      bundleRepo: async () => void (called = true)
    })
    await expect(sandbox.updateSharedRepo('../x', 'C:\\p')).rejects.toThrow()
    await expect(sandbox.updateSharedRepo('orca', 'relative\\path')).rejects.toThrow(/absolute/)
    expect(called).toBe(false)
    expect(world.calls).toHaveLength(0)
  })
})

describe('WslTicketSandbox.applyPolicy', () => {
  it('installs root-owned, non-writable policy files and returns their paths', async () => {
    const calls: Call[] = []
    const runWsl: RunWsl = async (args, opts) => {
      calls.push({
        user: args[args.indexOf('-u') + 1],
        cmd: args.slice(args.indexOf('--exec') + 1),
        opts
      })
      return ok()
    }
    const policy = effectivePolicy(baselineRules(), {
      allow: ['Bash(make test)'],
      ask: [],
      deny: []
    })
    const paths = await new WslTicketSandbox({ runWsl }).applyPolicy('SNPL-12', policy)
    expect(paths).toEqual({
      claudeSettings: '/etc/autosfactory/policy/SNPL-12/claude-settings.json',
      antigravitySettings: '/etc/autosfactory/policy/SNPL-12/antigravity-settings.json'
    })
    expect(calls.every((call) => call.user === 'root')).toBe(true)
    const writes = calls.filter((call) => call.cmd[0] === '/usr/bin/tee')
    expect(writes.map((call) => call.cmd[1])).toEqual([
      '/etc/claude-code/managed-settings.json',
      paths.claudeSettings,
      paths.antigravitySettings
    ])
    expect(JSON.parse(writes[0].opts?.input ?? '').permissions.disableBypassPermissionsMode).toBe(
      'disable'
    )
    expect(JSON.parse(writes[1].opts?.input ?? '').permissions.allow).toContain('Bash(make test)')
    expect(JSON.parse(writes[2].opts?.input ?? '').permissions.allow).toContain(
      'command(make test)'
    )
    const chown = calls.find((call) => call.cmd[0] === '/usr/bin/chown')
    expect(chown?.cmd.slice(1, 3)).toEqual(['root:root', '/etc/claude-code'])
    const modes = calls
      .filter((call) => call.cmd[0] === '/usr/bin/chmod')
      .map((call) => call.cmd[1])
    expect(modes).toEqual(['755', '644'])
    const lastWrite = calls.map((call) => call.cmd[0]).lastIndexOf('/usr/bin/tee')
    expect(calls.findIndex((call) => call.cmd[0] === '/usr/bin/chmod')).toBeGreaterThan(lastWrite)
  })

  it('rejects a bad ticket key before touching WSL and removes the files on destroy', async () => {
    const world = makeWorld()
    world.users.set('t-snpl-12', { comment: 'af-ticket=SNPL-12', groups: 'x' })
    const sandbox = new WslTicketSandbox({ runWsl: withGetentLookup(world) })
    const policy = effectivePolicy(baselineRules(), { allow: [], ask: [], deny: [] })
    await expect(sandbox.applyPolicy('../x-1', policy)).rejects.toThrow()
    expect(world.calls).toHaveLength(0)
    await sandbox.destroySession('SNPL-12')
    expect(
      world.calls.some(
        (call) =>
          call.cmd[0] === '/usr/bin/rm' && call.cmd[2] === '/etc/autosfactory/policy/SNPL-12'
      )
    ).toBe(true)
  })
})
