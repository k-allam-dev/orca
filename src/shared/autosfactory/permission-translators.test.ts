import { describe, expect, it } from 'vitest'
import { baselineRules, effectivePolicy, emptyRules } from './permission-policy'
import {
  toAntigravitySettings,
  toClaudeManagedSettings,
  toClaudeTicketSettings
} from './permission-translators'

describe('Claude translation', () => {
  it('puts only the global deny list in the managed file and disables bypass mode', () => {
    const managed = toClaudeManagedSettings(baselineRules())
    expect(managed.permissions.deny).toContain('Bash(rm -rf *)')
    expect(managed.permissions.allow).toEqual([])
    expect(managed.permissions.disableBypassPermissionsMode).toBe('disable')
    expect(managed.permissions.defaultMode).toBe('default')
  })

  it('writes the merged lists, dropping a bare Bash ask and asks shadowing an exact allow', () => {
    const repo = { ...emptyRules(), allow: ['Bash(curl -s https://example.com)'] }
    const ticket = toClaudeTicketSettings(effectivePolicy(baselineRules(), repo))
    expect(ticket.permissions.allow).toContain('Bash(curl -s https://example.com)')
    expect(ticket.permissions.allow).toContain('Edit(./**)')
    expect(ticket.permissions.ask).not.toContain('Bash')
    expect(ticket.permissions.ask).not.toContain('Bash(curl *)')
    expect(ticket.permissions.ask).toContain('Bash(wget *)')
    expect(ticket.permissions.ask).toContain('WebFetch')
    expect(ticket.permissions.deny).toEqual(expect.arrayContaining(baselineRules().deny))
  })
})

describe('Antigravity translation', () => {
  it('turns exact Bash allows into command(...) rules and reports the others', () => {
    const repo = { ...emptyRules(), allow: ['Bash(make test)', 'Bash(make lint *)'] }
    const { settings, skipped } = toAntigravitySettings(effectivePolicy(baselineRules(), repo))
    expect(settings.permissions.allow).toEqual([
      'command(git status)',
      'command(git diff)',
      'command(npm test)',
      'command(npm run lint)',
      'command(make test)'
    ])
    expect(skipped).toEqual(['Bash(make lint *)'])
  })

  it('never emits an allow rule for a denied command', () => {
    const global = { ...baselineRules(), allow: [...baselineRules().allow, 'Bash(rm -rf build)'] }
    const { settings } = toAntigravitySettings(effectivePolicy(global, emptyRules()))
    expect(settings.permissions.allow).not.toContain('command(rm -rf build)')
  })

  it('ask rules produce no allow entries', () => {
    const policy = effectivePolicy({ ...emptyRules(), ask: ['Bash(curl *)'] }, emptyRules())
    expect(toAntigravitySettings(policy).settings.permissions.allow).toEqual([])
  })
})
