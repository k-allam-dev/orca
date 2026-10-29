import {
  mergePolicies,
  parseRule,
  resolveAction,
  splitCommand,
  type PolicyRules
} from './permission-policy'

export type PromotionRequest = {
  command: string
  /** The repo of the ticket that asked; the rule is saved for this repo only. */
  ticketRepoKey: string
  /** The repo file the caller wants to write; must be the ticket's repo. */
  targetRepoKey: string
  /** A broader rule an agent suggested (for example `Bash(curl *)`); refused unless it is the exact command. */
  suggestedRule?: string
  global: PolicyRules
  repo: PolicyRules
}

export type PromotionResult =
  | { ok: true; rule: string; alreadyAllowed: boolean; updatedRepo: PolicyRules }
  | { ok: false; reason: string }

const MAX_COMMAND_LENGTH = 500

export function exactCommandRule(command: string): string {
  return `Bash(${command})`
}

function refuse(reason: string): PromotionResult {
  return { ok: false, reason }
}

export function planPromotion(request: PromotionRequest): PromotionResult {
  if (request.targetRepoKey !== request.ticketRepoKey) {
    return refuse(
      `A rule can only be saved for the ticket's own repo (${request.ticketRepoKey}), not ${request.targetRepoKey}.`
    )
  }
  const command = request.command.trim()
  if (command === '' || command.length > MAX_COMMAND_LENGTH) {
    return refuse(`The command must be 1 to ${MAX_COMMAND_LENGTH} characters.`)
  }
  if (/[\r\n\0]/.test(command)) {
    return refuse('A multi-line command cannot be made permanent.')
  }
  if (command.includes('*')) {
    return refuse('A command containing * cannot be made permanent: * is a wildcard in rules.')
  }
  const parts = splitCommand(command)
  if (parts === null || parts.length !== 1) {
    return refuse('A chained command or one with redirects or substitutions cannot be made permanent; allow its single commands instead.')
  }
  const rule = exactCommandRule(command)
  const parsed = parseRule(rule)
  if (typeof parsed === 'string') {
    return refuse(`The rule ${JSON.stringify(rule)} is not valid: ${parsed}`)
  }
  if (request.suggestedRule !== undefined && request.suggestedRule !== rule) {
    return refuse(
      `Refused ${JSON.stringify(request.suggestedRule)}: it is broader than the exact command. The narrowest rule is ${JSON.stringify(rule)}.`
    )
  }
  const effective = mergePolicies(request.global, request.repo).rules
  if (resolveAction({ allow: [], ask: [], deny: effective.deny }, { tool: 'Bash', value: command }) === 'deny') {
    return refuse('This command is on the deny list; no rule can allow it.')
  }
  const alreadyAllowed = request.repo.allow.includes(rule)
  return {
    ok: true,
    rule,
    alreadyAllowed,
    updatedRepo: alreadyAllowed
      ? request.repo
      : { ...request.repo, allow: [...request.repo.allow, rule] }
  }
}
