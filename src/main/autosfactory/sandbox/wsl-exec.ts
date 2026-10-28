import { execFile } from 'node:child_process'

export type WslResult = { code: number; stdout: string; stderr: string }
export type WslOptions = { input?: string; timeoutMs?: number }
export type RunWsl = (args: string[], opts?: WslOptions) => Promise<WslResult>

const DEFAULT_TIMEOUT_MS = 120_000

export function decodeWslOutput(buffer: Buffer): string {
  const utf16 = buffer.includes(0)
  const text = buffer.toString(utf16 ? 'utf16le' : 'utf8')
  return text.replace(/^﻿/, '').replace(/\0/g, '')
}

export const runWslExe: RunWsl = (args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      'wsl.exe',
      args,
      {
        encoding: 'buffer',
        windowsHide: true,
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error)
          return
        }
        const code = error && typeof error.code === 'number' ? error.code : 0
        resolve({ code, stdout: decodeWslOutput(stdout), stderr: decodeWslOutput(stderr) })
      }
    )
    child.stdin?.on('error', () => {})
    child.stdin?.end(opts.input ?? '')
  })
