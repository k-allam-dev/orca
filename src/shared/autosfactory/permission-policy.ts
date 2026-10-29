export const POLICY_TOOLS = ['Bash', 'Read', 'Edit', 'WebFetch', 'WebSearch'] as const

export type PolicyTool = (typeof POLICY_TOOLS)[number]

export type PolicyList = 'allow' | 'ask' | 'deny'

export type PolicyRules = {
  allow: string[]
  ask: string[]
  deny: string[]
}

export type Decision = PolicyList

export type ParsedRule = { tool: PolicyTool; specifier: string | null }

export type PolicyAction = { tool: PolicyTool; value: string }

export type EffectivePolicy = {
  global: PolicyRules
  merged: PolicyRules
}

const MAX_RULE_LENGTH = 1000
const RULE_PATTERN = /^([A-Za-z]+)(?:\(([\s\S]*)\))?$/
const LISTS = ['allow', 'ask', 'deny'] as const satisfies readonly PolicyList[]

export class PolicyParseError extends Error {
  readonly problems: string[]

  constructor(source: string, problems: string[]) {
    super(`Invalid permission policy ${source}:\n- ${problems.join('\n- ')}`)
    this.name = 'PolicyParseError'
    this.problems = problems
  }
}

export function parseRule(rule: string): ParsedRule | string {
  if (rule.length === 0 || rule.length > MAX_RULE_LENGTH) {
    return `rule must be 1 to ${MAX_RULE_LENGTH} characters`
  }
  if (/[\r\n\0]/.test(rule)) {
    return 'rule must be a single line'
  }
  const match = RULE_PATTERN.exec(rule)
  if (!match) {
    return 'rule must look like Tool or Tool(specifier), for example Bash(git status)'
  }
  const tool = POLICY_TOOLS.find((candidate) => candidate === match[1])
  if (!tool) {
    return `unknown tool "${match[1]}" (use ${POLICY_TOOLS.join(', ')})`
  }
  const specifier = match[2]
  if (specifier !== undefined && specifier.trim() === '') {
    return 'specifier between the brackets is empty'
  }
  if (specifier !== undefined && specifier !== specifier.trim()) {
    return 'specifier must not start or end with a space'
  }
  if ((tool === 'WebFetch' || tool === 'WebSearch') && specifier !== undefined) {
    return `${tool} rules take no specifier`
  }
  return { tool, specifier: specifier ?? null }
}

export function emptyRules(): PolicyRules {
  return { allow: [], ask: [], deny: [] }
}

export function parsePolicyText(text: string, source: string): PolicyRules {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new PolicyParseError(source, [
      `not valid JSON (${error instanceof Error ? error.message : String(error)})`
    ])
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new PolicyParseError(source, ['the file must contain a JSON object'])
  }
  const problems: string[] = []
  const rules = emptyRules()
  const record = Object.fromEntries(Object.entries(data))
  for (const key of Object.keys(record)) {
    if (key !== 'version' && !LISTS.some((list) => list === key)) {
      problems.push(`unknown key "${key}" (allowed: version, allow, ask, deny)`)
    }
  }
  if ('version' in record && record.version !== 1) {
    problems.push('version must be 1')
  }
  for (const list of LISTS) {
    const value = record[list]
    if (value === undefined) {
      continue
    }
    if (!Array.isArray(value)) {
      problems.push(`"${list}" must be a list of rule strings`)
      continue
    }
    value.forEach((entry, index) => {
      if (typeof entry !== 'string') {
        problems.push(`${list}[${index}] must be a string`)
        return
      }
      const parsed = parseRule(entry)
      if (typeof parsed === 'string') {
        problems.push(`${list}[${index}] ${JSON.stringify(entry)}: ${parsed}`)
        return
      }
      if (!rules[list].includes(entry)) {
        rules[list].push(entry)
      }
    })
  }
  if (problems.length > 0) {
    throw new PolicyParseError(source, problems)
  }
  return rules
}

export function serializePolicy(rules: PolicyRules): string {
  return `${JSON.stringify({ version: 1, allow: rules.allow, ask: rules.ask, deny: rules.deny }, null, 2)}\n`
}

export const BASELINE_POLICY: Readonly<PolicyRules> = {
  allow: [
    'Read(./**)',
    'Edit(./**)',
    'Bash(git status)',
    'Bash(git diff)',
    'Bash(npm test)',
    'Bash(npm run lint)'
  ],
  ask: [
    'Bash',
    'Bash(npm install *)',
    'Bash(npm i *)',
    'Bash(pnpm add *)',
    'Bash(pnpm install *)',
    'Bash(yarn add *)',
    'Bash(pip install *)',
    'Bash(curl *)',
    'Bash(wget *)',
    'WebFetch',
    'WebSearch'
  ],
  deny: [
    'Bash(rm -rf *)',
    'Bash(rm -fr *)',
    'Bash(rm -r *)',
    'Bash(git push --force *)',
    'Bash(git push -f *)',
    'Bash(git push * --force*)',
    'Read(**/.env)',
    'Read(**/.env.*)',
    'Read(**/*.pem)',
    'Read(**/*.key)',
    'Read(**/id_rsa*)',
    'Read(**/id_ed25519*)',
    'Read(~/.ssh/**)',
    'Edit(**/.env)',
    'Edit(**/.env.*)',
    'Edit(**/*.pem)',
    'Edit(**/*.key)'
  ]
}

export function baselineRules(): PolicyRules {
  return {
    allow: [...BASELINE_POLICY.allow],
    ask: [...BASELINE_POLICY.ask],
    deny: [...BASELINE_POLICY.deny]
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

function commandPatternToRegExp(pattern: string): RegExp {
  return new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 's')
}

function pathPatternToRegExp(pattern: string): RegExp {
  let source = ''
  let index = 0
  const clean = pattern.replace(/\\/g, '/').replace(/^\.\//, '')
  while (index < clean.length) {
    if (clean.startsWith('**/', index)) {
      source += '(?:.*/)?'
      index += 3
    } else if (clean.startsWith('**', index)) {
      source += '.*'
      index += 2
    } else if (clean[index] === '*') {
      source += '[^/]*'
      index += 1
    } else {
      source += escapeRegExp(clean[index])
      index += 1
    }
  }
  return new RegExp(`^${source}$`)
}

export function normalizePolicyPath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const parts: string[] = []
  for (const part of slashed.split('/')) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..') {
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  const joined = parts.join('/')
  return slashed.startsWith('/') || slashed.startsWith('~') ? `${slashed.startsWith('~') ? '' : '/'}${joined}` : joined
}

function pathIsInsideWorktree(normalized: string): boolean {
  return !normalized.startsWith('/') && !normalized.startsWith('~') && !normalized.startsWith('../') && normalized !== '..'
}

function ruleMatches(rule: ParsedRule, action: PolicyAction): boolean {
  if (rule.tool !== action.tool) {
    return false
  }
  if (rule.specifier === null) {
    return true
  }
  if (action.tool === 'Bash') {
    return commandPatternToRegExp(rule.specifier).test(action.value)
  }
  if (action.tool === 'Read' || action.tool === 'Edit') {
    const target = normalizePolicyPath(action.value)
    const spec = rule.specifier
    const insideOnly = spec.startsWith('./') || !(spec.startsWith('/') || spec.startsWith('~') || spec.startsWith('**'))
    if (insideOnly && !pathIsInsideWorktree(target)) {
      return false
    }
    return pathPatternToRegExp(spec.startsWith('~') ? spec : normalizePolicyPath(spec)).test(target)
  }
  return false
}

function listMatches(rules: string[], action: PolicyAction): boolean {
  return rules.some((raw) => {
    const parsed = parseRule(raw)
    return typeof parsed !== 'string' && ruleMatches(parsed, action)
  })
}

const COMPOUND_SPLIT = /&&|\|\||;|\||\r?\n|&/
const SHELL_TRICKS = /\$\(|`|<\(|>\(|[<>]/

export function splitCommand(command: string): string[] | null {
  if (SHELL_TRICKS.test(command)) {
    return null
  }
  return command
    .split(COMPOUND_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean)
}

function decideSingle(rules: PolicyRules, action: PolicyAction): Decision {
  if (listMatches(rules.deny, action)) {
    return 'deny'
  }
  const exactAllow = rules.allow.includes(`${action.tool}(${action.value})`)
  if (exactAllow) {
    return 'allow'
  }
  if (listMatches(rules.ask, action)) {
    return 'ask'
  }
  return listMatches(rules.allow, action) ? 'allow' : 'ask'
}

export function resolveAction(rules: PolicyRules, action: PolicyAction): Decision {
  if (action.tool !== 'Bash') {
    return decideSingle(rules, action)
  }
  const parts = splitCommand(action.value)
  if (parts === null) {
    const whole = decideSingle(rules, action)
    return whole === 'allow' && !rules.allow.includes(`Bash(${action.value})`) ? 'ask' : whole
  }
  const decisions = parts.map((part) => decideSingle(rules, { tool: 'Bash', value: part }))
  if (decisions.includes('deny')) {
    return 'deny'
  }
  return parts.length === 0 || decisions.includes('ask') ? 'ask' : 'allow'
}

export type MergeResult = { rules: PolicyRules; droppedRepoRules: string[] }

function exactRuleAction(rule: string): PolicyAction | null {
  const parsed = parseRule(rule)
  if (typeof parsed === 'string' || parsed.specifier === null || parsed.specifier.includes('*')) {
    return null
  }
  return { tool: parsed.tool, value: parsed.specifier }
}

export function mergePolicies(global: PolicyRules, repo: PolicyRules): MergeResult {
  const union = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])]
  const droppedRepoRules: string[] = []
  const allowFromRepo = repo.allow.filter((rule) => {
    const action = exactRuleAction(rule)
    const blocked = action !== null && resolveAction({ ...emptyRules(), deny: global.deny }, action) === 'deny'
    const broad = action === null && listMatchesAnyDenyAsBroader(rule, global.deny)
    if (blocked || broad) {
      droppedRepoRules.push(rule)
    }
    return !(blocked || broad)
  })
  return {
    rules: {
      allow: union(global.allow, allowFromRepo),
      ask: union(global.ask, repo.ask),
      deny: union(global.deny, repo.deny)
    },
    droppedRepoRules
  }
}

function listMatchesAnyDenyAsBroader(allowRule: string, deny: string[]): boolean {
  const parsed = parseRule(allowRule)
  if (typeof parsed === 'string') {
    return false
  }
  return deny.some((denyRule) => {
    const denied = parseRule(denyRule)
    if (typeof denied === 'string' || denied.tool !== parsed.tool) {
      return false
    }
    return denied.specifier === null || parsed.specifier === null || denied.specifier === parsed.specifier
  })
}

export function effectivePolicy(global: PolicyRules, repo: PolicyRules): EffectivePolicy {
  return { global, merged: mergePolicies(global, repo).rules }
}
