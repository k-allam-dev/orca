import { describe, expect, it } from 'vitest'
import {
  baselineRules,
  emptyRules,
  mergePolicies,
  parsePolicyText,
  PolicyParseError,
  resolveAction,
  serializePolicy,
  type PolicyRules
} from './permission-policy'

const bash = (value: string) => ({ tool: 'Bash' as const, value })
const read = (value: string) => ({ tool: 'Read' as const, value })
const edit = (value: string) => ({ tool: 'Edit' as const, value })

describe('parsePolicyText', () => {
  it('accepts a hand-edited file and round-trips the baseline', () => {
    const rules = parsePolicyText('{"allow":["Bash(npm test)"],"deny":["Read(**/.env)"]}', 'x.json')
    expect(rules).toEqual({ allow: ['Bash(npm test)'], ask: [], deny: ['Read(**/.env)'] })
    const baseline = baselineRules()
    expect(parsePolicyText(serializePolicy(baseline), 'b')).toEqual(baseline)
  })

  it('reports every problem with a readable message', () => {
    const text = JSON.stringify({
      version: 2,
      allow: ['Bash()', 'Nope(x)', 5, 'Bash(a\nb)', 'WebFetch(example.com)', ' Bash'],
      ask: 'Bash',
      extra: []
    })
    let error: unknown
    try {
      parsePolicyText(text, 'repo.json')
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PolicyParseError)
    const message = String(error)
    expect(message).toContain('repo.json')
    expect(message).toContain('unknown key "extra"')
    expect(message).toContain('version must be 1')
    expect(message).toContain('allow[0]')
    expect(message).toContain('unknown tool "Nope"')
    expect(message).toContain('allow[2] must be a string')
    expect(message).toContain('single line')
    expect(message).toContain('take no specifier')
    expect(message).toContain('"ask" must be a list')
  })

  it('rejects non-JSON and non-objects', () => {
    expect(() => parsePolicyText('allow: x', 'f')).toThrow(/not valid JSON/)
    expect(() => parsePolicyText('[]', 'f')).toThrow(/JSON object/)
  })
})

describe('resolveAction', () => {
  const rules = baselineRules()

  it('allows the baseline commands and edits inside the worktree', () => {
    for (const command of ['git status', 'git diff', 'npm test', 'npm run lint']) {
      expect(resolveAction(rules, bash(command)), command).toBe('allow')
    }
    expect(resolveAction(rules, read('src/a.ts'))).toBe('allow')
    expect(resolveAction(rules, edit('./src/a.ts'))).toBe('allow')
  })

  it('asks for installs, network and other commands', () => {
    for (const command of [
      'npm install left-pad',
      'curl https://example.com',
      'ls -la',
      'git status --short'
    ]) {
      expect(resolveAction(rules, bash(command)), command).toBe('ask')
    }
    expect(resolveAction(rules, { tool: 'WebFetch', value: '' })).toBe('ask')
  })

  it('denies destructive commands and secrets, deny beating allow and ask', () => {
    for (const command of [
      'rm -rf /',
      'rm -rf node_modules',
      'git push --force origin main',
      'git push origin main --force'
    ]) {
      expect(resolveAction(rules, bash(command)), command).toBe('deny')
    }
    for (const path of [
      '.env',
      'a/b/.env',
      '.env.local',
      'keys/server.pem',
      '.ssh/id_rsa',
      '~/.ssh/config'
    ]) {
      expect(resolveAction(rules, read(path)), path).toBe('deny')
    }
    expect(resolveAction(rules, edit('.env'))).toBe('deny')
    const both: PolicyRules = {
      allow: ['Bash(rm -rf *)'],
      ask: ['Bash(rm -rf *)'],
      deny: ['Bash(rm -rf *)']
    }
    expect(resolveAction(both, bash('rm -rf x'))).toBe('deny')
  })

  it('does not allow edits or reads outside the worktree', () => {
    expect(resolveAction(rules, edit('../other/a.ts'))).toBe('ask')
    expect(resolveAction(rules, edit('/etc/passwd'))).toBe('ask')
    expect(resolveAction(rules, read('src/../../x'))).toBe('ask')
  })

  it('checks every part of a chained command and refuses substitutions', () => {
    expect(resolveAction(rules, bash('git status && git diff'))).toBe('allow')
    expect(resolveAction(rules, bash('git status && rm -rf x'))).toBe('deny')
    expect(resolveAction(rules, bash('git status; curl https://x'))).toBe('ask')
    expect(resolveAction(rules, bash('git status $(whoami)'))).toBe('ask')
    expect(resolveAction(rules, bash('git diff > out.txt'))).toBe('ask')
  })

  it('lets an exact allow rule beat a broader ask, but never a deny', () => {
    const custom: PolicyRules = {
      allow: ['Bash(curl -s https://example.com)', 'Bash(rm -rf build)'],
      ask: ['Bash(curl *)'],
      deny: ['Bash(rm -rf *)']
    }
    expect(resolveAction(custom, bash('curl -s https://example.com'))).toBe('allow')
    expect(resolveAction(custom, bash('curl -s https://evil.example'))).toBe('ask')
    expect(resolveAction(custom, bash('rm -rf build'))).toBe('deny')
  })
})

describe('mergePolicies', () => {
  it('adds repo rules to the global ones', () => {
    const global = baselineRules()
    const repo = { ...emptyRules(), allow: ['Bash(make test)'], deny: ['Bash(make deploy)'] }
    const { rules } = mergePolicies(global, repo)
    expect(rules.allow).toContain('Bash(make test)')
    expect(rules.allow).toContain('Bash(git status)')
    expect(resolveAction(rules, bash('make deploy'))).toBe('deny')
  })

  it('never lets a repo file loosen a global deny', () => {
    const global = baselineRules()
    const repo = {
      ...emptyRules(),
      allow: ['Bash(rm -rf build)', 'Read(**/.env)', 'Bash(git push --force origin x)', 'Bash(make)']
    }
    const { rules, droppedRepoRules } = mergePolicies(global, repo)
    expect(droppedRepoRules).toContain('Bash(rm -rf build)')
    expect(droppedRepoRules).toContain('Bash(git push --force origin x)')
    expect(resolveAction(rules, bash('rm -rf build'))).toBe('deny')
    expect(resolveAction(rules, bash('git push --force origin x'))).toBe('deny')
    expect(resolveAction(rules, read('.env'))).toBe('deny')
    expect(rules.deny).toEqual(expect.arrayContaining(global.deny))
  })
})
