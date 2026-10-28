import { runWslExe } from '../src/main/autosfactory/sandbox/wsl-exec'
import { WslTicketSandbox } from '../src/main/autosfactory/sandbox/wsl-ticket-sandbox'

const DISTRO = process.argv[2]
if (DISTRO !== 'af-test') {
  throw new Error('This smoke script only runs against the disposable distro af-test')
}
const KEY = 'ZZTEST-1'
const BARE = '/tmp/zztest-bare.git'

async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const start = Date.now()
  const value = await work()
  console.log(`[${((Date.now() - start) / 1000).toFixed(2)}s] ${label}`)
  return value
}

async function sh(user: string, script: string) {
  return runWslExe(['-d', DISTRO, '-u', user, '--exec', '/bin/bash', '-s'], { input: script })
}

async function main(): Promise<void> {
  const sandbox = new WslTicketSandbox({ runWsl: runWslExe, distro: DISTRO })
  await sh('root', `set -e; rm -rf ${BARE} /tmp/zzseed; git init -q --bare ${BARE}; git init -q /tmp/zzseed; cd /tmp/zzseed; git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init; git branch -M main; git push -q ${BARE} main; chmod -R a+rX ${BARE}; git config --system --add safe.directory ${BARE}; git -C ${BARE} symbolic-ref HEAD refs/heads/main`)
  await timed('ensureReady', () => sandbox.ensureReady())
  await timed('ensureReady (second call)', () => sandbox.ensureReady())
  const session = await timed('createSession', () =>
    sandbox.createSession(KEY, { repoUrl: BARE, branch: 'zztest-branch' })
  )
  console.log(JSON.stringify(session))
  await timed('createSession again (idempotent)', () =>
    sandbox.createSession(KEY, { repoUrl: BARE, branch: 'zztest-branch' })
  )
  const user = session.linuxUser
  const report = await sh(
    user,
    `echo whoami=$(whoami); echo branch=$(git -C ${session.worktreeDir} branch --show-current); echo groups=$(id -nG); echo home_mode=$(stat -c %a $HOME); echo tkt1_read=$(cat /home/tkt1/s.txt 2>&1 | head -c 80); echo tkt1_ls=$(ls /home/tkt1 2>&1 | head -c 80); echo sudo=$(sudo -n true 2>&1 | head -c 80); echo mnt_c=[$(ls -A /mnt/c 2>&1)]; echo winexe=$(/mnt/c/Windows/System32/cmd.exe /c echo hi 2>&1 | head -c 80); echo gw_ping=$(timeout 3 bash -c 'echo > /dev/tcp/172.30.192.1/445' 2>&1 | head -c 80); echo net=$(timeout 8 git ls-remote https://github.com/octocat/Hello-World.git HEAD 2>&1 | head -c 60); echo nft_del=$(nft delete table inet fw 2>&1 | head -c 80)`
  )
  console.log(report.stdout.trim(), report.stderr.trim())
  console.log('sessions', JSON.stringify(await sandbox.listSessions()))
  await sh(user, 'sleep 300 &')
  await timed('stopSession', () => sandbox.stopSession(KEY))
  const afterStop = await sh('root', `pgrep -u ${user} | wc -l; test -d ${session.worktreeDir} && echo files_kept`)
  console.log('after stop:', afterStop.stdout.trim().replace(/\n/g, ' '))
  await timed('destroySession', () => sandbox.destroySession(KEY))
  const gone = await sh('root', `getent passwd ${user} || echo user_gone; test -e /home/${user} || echo home_gone; rm -rf ${BARE} /tmp/zzseed; git config --system --unset-all safe.directory; echo cleaned`)
  console.log('after destroy:', gone.stdout.trim().replace(/\n/g, ' '))
  console.log('sessions', JSON.stringify(await sandbox.listSessions()))
}

main().catch(async (error) => {
  console.error('FAILED', error)
  process.exitCode = 1
})
