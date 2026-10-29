import { describe, expect, it } from 'vitest'
import { baselineRules, emptyRules, resolveAction } from './permission-policy'
import { planPromotion } from './permission-promotion'

const base = {
  ticketRepoKey: 'orca',
  targetRepoKey: 'orca',
  global: baselineRules(),
  repo: emptyRules()
}

describe('planPromotion', () => {
  it('computes the exact-command rule and adds it to the repo list only', () => {
    const result = planPromotion({ ...base, command: '  curl -s https://example.com ' })
    expect(result).toMatchObject({
      ok: true,
      rule: 'Bash(curl -s https://example.com)',
      alreadyAllowed: false
    })
    if (result.ok) {
      expect(result.updatedRepo.allow).toEqual(['Bash(curl -s https://example.com)'])
      expect(result.updatedRepo.deny).toEqual([])
    }
  })

  it('is idempotent', () => {
    const repo = { ...emptyRules(), allow: ['Bash(make test)'] }
    expect(planPromotion({ ...base, repo, command: 'make test' })).toMatchObject({
      ok: true,
      alreadyAllowed: true
    })
  })

  it('refuses the broad wildcard Claude Code suggests', () => {
    const result = planPromotion({
      ...base,
      command: 'curl https://example.com',
      suggestedRule: 'Bash(curl *)'
    })
    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).toContain('broader than the exact command')
  })

  it('accepts a suggestion that equals the exact command', () => {
    const result = planPromotion({ ...base, command: 'make test', suggestedRule: 'Bash(make test)' })
    expect(result.ok).toBe(true)
  })

  it('refuses wildcards, chains and multi-line commands', () => {
    for (const command of ['curl *', 'ls *.txt', 'a && b', 'echo $(id)', 'x\ny', 'cat a > b', '']) {
      expect(planPromotion({ ...base, command }).ok, command).toBe(false)
    }
  })

  it('refuses destructive commands on the deny list', () => {
    for (const command of ['rm -rf /', 'rm -rf build', 'git push --force origin main']) {
      expect(planPromotion({ ...base, command }), command).toMatchObject({ ok: false })
    }
  })

  it('refuses a secrets read once the deny list covers it as a command', () => {
    const global = { ...baselineRules(), deny: [...baselineRules().deny, 'Bash(cat *.env*)'] }
    expect(planPromotion({ ...base, global, command: 'cat .env' }).ok).toBe(false)
  })

  it('refuses a command a repo-level deny rule covers', () => {
    const repo = { ...emptyRules(), deny: ['Bash(make deploy *)'] }
    expect(planPromotion({ ...base, repo, command: 'make deploy prod' }).ok).toBe(false)
  })

  it('refuses a rule for a different repo', () => {
    const result = planPromotion({ ...base, targetRepoKey: 'other', command: 'make test' })
    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).toContain("ticket's own repo")
  })

  it('the promoted rule makes exactly that command allowed and nothing else', () => {
    const result = planPromotion({ ...base, command: 'curl -s https://example.com' })
    if (!result.ok) {
      throw new Error('expected success')
    }
    const rules = { ...base.global, allow: [...base.global.allow, ...result.updatedRepo.allow] }
    const run = (value: string) => resolveAction(rules, { tool: 'Bash', value })
    expect(run('curl -s https://example.com')).toBe('allow')
    expect(run('curl -s https://example.com --data @x')).toBe('ask')
    expect(run('curl -s https://example.com && cat /x')).toBe('ask')
  })
})
