import { createHash } from 'node:crypto'
import { TICKET_USER_PREFIX } from '../../../shared/autosfactory/sandbox-config'

const TICKET_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/
const MAX_TICKET_KEY_LENGTH = 64
const MAX_LINUX_USER_LENGTH = 32
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const REPO_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function assertTicketKey(ticketKey: string): void {
  if (ticketKey.length > MAX_TICKET_KEY_LENGTH || !TICKET_KEY_PATTERN.test(ticketKey)) {
    throw new Error(`Invalid ticket key: ${JSON.stringify(ticketKey)}`)
  }
}

export function assertBranchName(branch: string): void {
  const bad =
    !BRANCH_PATTERN.test(branch) ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.includes('/.') ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.endsWith('.lock')
  if (bad) {
    throw new Error(`Invalid branch name: ${JSON.stringify(branch)}`)
  }
}

export function assertRepoKey(repoKey: string): void {
  const bad =
    !REPO_KEY_PATTERN.test(repoKey) ||
    repoKey.includes('..') ||
    repoKey.endsWith('.') ||
    repoKey.endsWith('.git') ||
    repoKey.endsWith('.lock')
  if (bad) {
    throw new Error(`Invalid repository key: ${JSON.stringify(repoKey)}`)
  }
}

export function linuxUserForTicket(ticketKey: string): string {
  assertTicketKey(ticketKey)
  const name = `${TICKET_USER_PREFIX}${ticketKey.toLowerCase()}`
  if (name.length <= MAX_LINUX_USER_LENGTH) {
    return name
  }
  const digest = createHash('sha256').update(ticketKey).digest('hex').slice(0, 8)
  const head = name.slice(0, MAX_LINUX_USER_LENGTH - digest.length - 1)
  return `${head}-${digest}`
}
