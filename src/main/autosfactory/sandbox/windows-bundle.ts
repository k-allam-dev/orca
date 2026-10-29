import { execFile } from 'node:child_process'
import { SANDBOX_BASE_BRANCH } from '../../../shared/autosfactory/sandbox-config'

export type FetchRepo = (windowsRepoPath: string) => Promise<void>
export type BundleRepo = (windowsRepoPath: string, bundleFile: string) => Promise<void>

export const BUNDLE_REF = `refs/remotes/origin/${SANDBOX_BASE_BRANCH}`

function git(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        windowsHide: true,
        timeout: 300_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      },
      (error, _stdout, stderr) => {
        if (error) {
          reject(
            new Error(`git ${args.join(' ')} failed in ${cwd}: ${stderr.trim() || error.message}`)
          )
          return
        }
        resolve()
      }
    )
  })
}

export const fetchWindowsRepo: FetchRepo = async (windowsRepoPath) => {
  await git(['fetch', 'origin', SANDBOX_BASE_BRANCH], windowsRepoPath)
}

// Why: Windows holds the git login; the distro only ever receives this file, never credentials.
export const bundleWindowsRepo: BundleRepo = async (windowsRepoPath, bundleFile) => {
  await git(['bundle', 'create', bundleFile, BUNDLE_REF], windowsRepoPath)
}
