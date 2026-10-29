import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SHARED_REPOS_DIR } from '../src/shared/autosfactory/sandbox-config'
import { ticketBranchName } from '../src/shared/autosfactory/ticket-runner'
import { runWslExe } from '../src/main/autosfactory/sandbox/wsl-exec'
import { WslTicketSandbox } from '../src/main/autosfactory/sandbox/wsl-ticket-sandbox'
import { SharedRepoRefresher } from '../src/main/autosfactory/runner/shared-repo-refresher'

const DISTRO = process.argv[2]
if (DISTRO !== 'af-test') {
  throw new Error('This smoke script only runs against the disposable distro af-test')
}
const REPO_KEY = 'zzrefresh'
const SHARED = `${SHARED_REPOS_DIR}/${REPO_KEY}.git`
const TICKETS = [
  ['ZZTEST-2', 'Replace, add: documents (v2) / "balance" transfer!!'],
  [
    'ZZTEST-3',
    'A very long summary that goes on and on about balance transfer requests and documents and more'
  ]
] as const

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

function commit(project: string, file: string): void {
  writeFileSync(join(project, file), `${file}\n`)
  git(project, 'add', '.')
  git(project, 'commit', '-q', '-m', `add ${file}`)
  git(project, 'push', '-q', 'origin', 'develop')
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'af-refresh-'))
  const origin = join(root, 'origin.git')
  const moved = join(root, 'origin-moved.git')
  const project = join(root, 'project')
  mkdirSync(project)
  git(root, 'init', '-q', '--bare', '-b', 'develop', origin)
  git(project, 'init', '-q', '-b', 'develop')
  git(project, 'remote', 'add', 'origin', origin)
  commit(project, 'one.txt')

  const sandbox = new WslTicketSandbox({ runWsl: runWslExe, distro: DISTRO })
  const refresher = new SharedRepoRefresher({
    sandbox,
    listRepos: async () => [{ repoKey: REPO_KEY, windowsRepoPath: project }]
  })
  try {
    await sandbox.ensureReady()
    console.log('first update:', JSON.stringify(await sandbox.updateSharedRepo(REPO_KEY, project)))

    renameSync(origin, moved)
    console.log('origin removed; update:', JSON.stringify(await sandbox.updateSharedRepo(REPO_KEY, project)))
    for (const [key, title] of TICKETS) {
      const workBranch = ticketBranchName(key, title)
      const session = await sandbox.createSession(key, {
        repoKey: REPO_KEY,
        baseBranch: 'develop',
        workBranch
      })
      console.log(`expected ${workBranch}`)
      console.log(
        'actual   ',
        await sh(session.linuxUser, `cd ${session.worktreeDir}; echo $(git branch --show-current) files=$(ls | tr "\n" " ")`)
      )
    }
    const again = await sandbox.createSession(TICKETS[0][0], {
      repoKey: REPO_KEY,
      baseBranch: 'develop',
      workBranch: ticketBranchName(...TICKETS[0])
    })
    console.log('reuse existing branch ok:', again.worktreeDir)

    renameSync(moved, origin)
    commit(project, 'two.txt')
    const status = await refresher.refreshNow()
    console.log('refresher:', JSON.stringify(status))
    console.log(
      'shared develop files:',
      await sh('root', `git --git-dir=${SHARED} ls-tree --name-only develop | tr "\n" " "`)
    )
  } finally {
    for (const [key] of TICKETS) {
      await sandbox.destroySession(key).catch((error) => console.error('destroy', key, error))
    }
    console.log(await sh('root', `rm -rf ${SHARED}; ls ${SHARED_REPOS_DIR}; getent passwd | grep -c "^t-zztest" || true`))
    rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('FAILED', error)
  process.exitCode = 1
})
