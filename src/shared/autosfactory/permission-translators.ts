import { parseRule, resolveAction, type EffectivePolicy, type PolicyRules } from './permission-policy'

export type ClaudeSettingsFile = {
  permissions: {
    allow: string[]
    ask: string[]
    deny: string[]
    defaultMode?: 'default'
    disableBypassPermissionsMode?: 'disable'
  }
}

export type AntigravitySettingsFile = {
  permissions: { allow: string[] }
}

export type AntigravityTranslation = {
  settings: AntigravitySettingsFile
  /** Allow rules that cannot become an exact `command(...)` rule (wildcards, paths, web). */
  skipped: string[]
}

function isExactBash(rule: string): string | null {
  const parsed = parseRule(rule)
  if (typeof parsed === 'string' || parsed.tool !== 'Bash' || parsed.specifier === null) {
    return null
  }
  return parsed.specifier.includes('*') ? null : parsed.specifier
}

/** Claude Code lets a managed `ask` beat any `allow`, so an ask rule that would shadow an exact allow is left out, and so is a bare Bash ask; manual mode asks for unlisted commands anyway. */
function asksWithoutShadowing(rules: PolicyRules): string[] {
  const exact = rules.allow.map(isExactBash).filter((value): value is string => value !== null)
  return rules.ask.filter((rule) => {
    const parsed = parseRule(rule)
    if (typeof parsed === 'string' || parsed.tool !== 'Bash') {
      return true
    }
    if (parsed.specifier === null) {
      return false
    }
    const pattern = new RegExp(
      `^${parsed.specifier
        .split('*')
        .map((chunk) => chunk.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`,
      's'
    )
    return !exact.some((command) => pattern.test(command))
  })
}

/** Rules for the distro-wide managed file: nothing here can be loosened by a ticket user's own files. */
export function toClaudeManagedSettings(global: PolicyRules): ClaudeSettingsFile {
  return {
    permissions: {
      allow: [],
      ask: [],
      deny: [...global.deny],
      defaultMode: 'default',
      disableBypassPermissionsMode: 'disable'
    }
  }
}

/** Settings file passed to `claude --settings <file>` for one ticket; root-owned in the sandbox. */
export function toClaudeTicketSettings(policy: EffectivePolicy): ClaudeSettingsFile {
  return {
    permissions: {
      allow: [...policy.merged.allow],
      ask: asksWithoutShadowing(policy.merged),
      deny: [...policy.merged.deny],
      defaultMode: 'default',
      disableBypassPermissionsMode: 'disable'
    }
  }
}

/** Antigravity headless denies every shell command without an exact `command(...)` allow rule, so ask and deny rules need no entry. */
export function toAntigravitySettings(policy: EffectivePolicy): AntigravityTranslation {
  const allow: string[] = []
  const skipped: string[] = []
  for (const rule of policy.merged.allow) {
    const parsed = parseRule(rule)
    if (typeof parsed === 'string' || parsed.tool !== 'Bash') {
      continue
    }
    const exact = isExactBash(rule)
    if (exact === null) {
      skipped.push(rule)
    } else if (
      !allow.includes(`command(${exact})`) &&
      resolveAction({ allow: [], ask: [], deny: policy.merged.deny }, { tool: 'Bash', value: exact }) !== 'deny'
    ) {
      allow.push(`command(${exact})`)
    }
  }
  return { settings: { permissions: { allow } }, skipped }
}
