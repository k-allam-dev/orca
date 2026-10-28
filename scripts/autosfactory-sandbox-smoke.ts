import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SHARED_REPOS_DIR } from '../src/shared/autosfactory/sandbox-config'
import { runWslExe } from '../src/main/autosfactory/sandbox/wsl-exec'
import { WslTicketSandbox } from '../src/main/autosfactory/sandbox/wsl-ticket-sandbox'

const DISTRO = process.argv[2]
if (DISTRO !== 'af-test') {
  throw new Error('This smoke script only runs against the disposable distro af-test')
}
const REPO_KEY = 'zzrepo'
const KEYS = ['ZZTEST-2', 'ZZTEST-3']
const SHARED = `${SHARED_REPOS_DIR}/${REPO_KEY}.git`

async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const start = Date.now()
  const value = await work()
  console.log(`[${((Date.now() - start) / 1000).toFixed(2)}s] ${label}`)
  return value
}

async function sh(user: string, script: string): Promise<string> {
  const result = await runWslExe(['-d', DISTRO, '-u', user, '--exec', '/bin/bash', '-s'], {
    input: script
  })
  return `${result.stdout}${result.stderr}`.trim()
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=smoke', '-c', 'user.email=smoke@example.test', ...args],
    { cwd, encoding: 'utf8' }
  ).trim()
}

function commit(project: string, file: string, text: string): void {
  writeFileSync(join(project, file), text)
  git(project, 'add', '.')
  git(project, 'commit', '-q', '-m', `add ${file}`)
  git(project, 'push', '-q', 'origin', 'develop')
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'af-smoke-'))
  const origin = join(root, 'origin.git')
  const project = join(root, 'project')
  mkdirSync(project)
  git(root, 'init', '-q', '--bare', '-b', 'develop', origin)
  git(project, 'init', '-q', '-b', 'develop')
  git(project, 'remote', 'add', 'origin', origin)
  commit(project, 'one.txt', 'first\n')
  commit(project, 'two.txt', 'second\n')

  const sandbox = new WslTicketSandbox({ runWsl: runWslExe, distro: DISTRO })
  try {
    await timed('ensureReady', () => sandbox.ensureReady())
    await timed('ensureReady (second call)', () => sandbox.ensureReady())
    await timed('updateSharedRepo (first)', () => sandbox.updateSharedRepo(REPO_KEY, project))
    const session = await timed(`createSession ${KEYS[0]}`, () =>
      sandbox.createSession(KEYS[0], {
        repoKey: REPO_KEY,
        baseBranch: 'develop',
        workBranch: 'autosfactory/ZZTEST-2'
      })
    )
    console.log(JSON.stringify(session))
    const user = session.linuxUser
    const dir = session.worktreeDir
    console.log(
      await sh(
        user,
        [
          `cd ${dir}`,
          'echo branch=$(git branch --show-current)',
          'echo files=$(ls | tr "\\n" " ")',
          'echo owner=$(stat -c %U .)',
          'echo write_own=$(echo x > mine.txt && echo yes || echo no)',
          'git add mine.txt && git -c user.name=t -c user.email=t@t commit -q -m mine && echo commit=yes',
          `echo write_shared=$(touch ${SHARED}/hack 2>&1 | head -1)`,
          `echo write_shared_refs=$(echo deadbeef > ${SHARED}/refs/heads/develop 2>&1 | head -1)`,
          `echo shared_owner=$(stat -c %U ${SHARED})`,
          'echo sudo=$(sudo -n true 2>&1 | head -1)'
        ].join('\n')
      )
    )

    commit(project, 'three.txt', 'third\n')
    await timed('updateSharedRepo (second, new commit)', () =>
      sandbox.updateSharedRepo(REPO_KEY, project)
    )
    const second = await timed(`createSession ${KEYS[1]}`, () =>
      sandbox.createSession(KEYS[1], {
        repoKey: REPO_KEY,
        baseBranch: 'develop',
        workBranch: 'autosfactory/ZZTEST-3'
      })
    )
    console.log(
      await sh(
        second.linuxUser,
        `cd ${second.worktreeDir}; echo files=$(ls | tr "\\n" " "); echo branch=$(git branch --show-current)`
      )
    )
    console.log(
      'first ticket still has its own state:',
      await sh(user, `cd ${dir}; echo files=$(ls | tr "\\n" " ")`)
    )

    const gateway = await sh('root', "ip route show default | awk '{print $3}'")
    console.log(
      await sh(
        user,
        [
          'probe() { timeout 4 bash -c "exec 3<>/dev/tcp/$1/$2" 2>&1 | head -1; echo "$1:$2 exit=${PIPESTATUS[0]}"; }',
          `probe ${gateway} 445`,
          'probe 192.168.1.1 80',
          'probe 10.1.2.3 80',
          'probe 169.254.169.254 80',
          'probe 1.1.1.1 443',
          'echo dns=$(getent hosts github.com | head -1)',
          'echo nft=$(/usr/sbin/nft delete table inet fw 2>&1 | head -1)'
        ].join('\n')
      )
    )
  } finally {
    for (const key of KEYS) {
      await sandbox.destroySession(key).catch((error) => console.error('destroy', key, error))
    }
    console.log(
      await sh(
        'root',
        `rm -rf ${SHARED}; ls ${SHARED_REPOS_DIR}; getent passwd | grep -c "^t-zztest" || true`
      )
    )
    rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exitCode = 1
})
