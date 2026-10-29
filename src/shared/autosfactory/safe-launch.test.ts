import { describe, expect, it } from 'vitest'
import {
  buildAntigravityLaunchArgs,
  buildClaudeLaunchArgs,
  launchArgsRelaxPermissions
} from './safe-launch'

describe('safe launch arguments', () => {
  it('starts Claude in default permission mode with the policy file and no skip flag', () => {
    const args = buildClaudeLaunchArgs({ settingsPath: '/p/claude-settings.json', model: 'sonnet' })
    expect(args).toEqual([
      '--permission-mode',
      'default',
      '--settings',
      '/p/claude-settings.json',
      '--model',
      'sonnet'
    ])
    expect(launchArgsRelaxPermissions(args)).toBe(false)
  })

  it('starts Antigravity with only the session settings file', () => {
    const args = buildAntigravityLaunchArgs({ settingsPath: '/p/a.json' })
    expect(args).toEqual(['--settings', '/p/a.json'])
    expect(launchArgsRelaxPermissions(args)).toBe(false)
  })

  it('rejects extra arguments that skip or relax permissions', () => {
    for (const extra of [
      '--dangerously-skip-permissions',
      '--allow-dangerously-skip-permissions',
      '--permission-mode=auto',
      '--settings',
      '--allowedTools'
    ]) {
      expect(() => buildClaudeLaunchArgs({ extraArgs: [extra] }), extra).toThrow(/not allowed/)
    }
    for (const extra of ['--dangerously-skip-permissions', '--mode', '--mode=auto', '--settings=x']) {
      expect(() => buildAntigravityLaunchArgs({ extraArgs: [extra] }), extra).toThrow(/not allowed/)
    }
  })

  it('detects relaxed launches', () => {
    expect(launchArgsRelaxPermissions(['--dangerously-skip-permissions'])).toBe(true)
    expect(launchArgsRelaxPermissions(['--permission-mode', 'bypassPermissions'])).toBe(true)
    expect(launchArgsRelaxPermissions(['--permission-mode', 'default'])).toBe(false)
    expect(launchArgsRelaxPermissions(['--mode', 'auto'])).toBe(true)
  })
})
