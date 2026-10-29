import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  baselineRules,
  emptyRules,
  effectivePolicy,
  parsePolicyText,
  serializePolicy,
  type EffectivePolicy,
  type PolicyRules
} from '../../../shared/autosfactory/permission-policy'
import {
  planPromotion,
  type PromotionResult
} from '../../../shared/autosfactory/permission-promotion'
import { assertRepoKey } from '../sandbox/ticket-user'

export const POLICY_SUBDIR = join('autosfactory', 'policy')

export type PolicyStore = {
  globalPath(): string
  repoPath(repoKey: string): string
  loadGlobal(): Promise<PolicyRules>
  loadRepo(repoKey: string): Promise<PolicyRules>
  loadEffective(repoKey: string): Promise<EffectivePolicy>
  promoteCommand(args: {
    ticketRepoKey: string
    targetRepoKey: string
    command: string
    suggestedRule?: string
  }): Promise<PromotionResult>
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  const temp = `${path}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
}

/** `userDataDir` is Orca's userData folder; files live under `autosfactory/policy/`. */
export function createPolicyStore(userDataDir: string): PolicyStore {
  const root = join(userDataDir, POLICY_SUBDIR)
  const globalPath = (): string => join(root, 'global.json')
  const repoPath = (repoKey: string): string => {
    assertRepoKey(repoKey)
    return join(root, 'repos', `${repoKey}.json`)
  }

  async function loadGlobal(): Promise<PolicyRules> {
    const path = globalPath()
    try {
      return parsePolicyText(await readFile(path, 'utf8'), path)
    } catch (error) {
      if (!isMissing(error)) {
        throw error
      }
      const baseline = baselineRules()
      await writeAtomic(path, serializePolicy(baseline))
      return baseline
    }
  }

  async function loadRepo(repoKey: string): Promise<PolicyRules> {
    const path = repoPath(repoKey)
    try {
      return parsePolicyText(await readFile(path, 'utf8'), path)
    } catch (error) {
      if (isMissing(error)) {
        return emptyRules()
      }
      throw error
    }
  }

  return {
    globalPath,
    repoPath,
    loadGlobal,
    loadRepo,
    async loadEffective(repoKey) {
      return effectivePolicy(await loadGlobal(), await loadRepo(repoKey))
    },
    async promoteCommand({ ticketRepoKey, targetRepoKey, command, suggestedRule }) {
      assertRepoKey(ticketRepoKey)
      assertRepoKey(targetRepoKey)
      const result = planPromotion({
        command,
        ticketRepoKey,
        targetRepoKey,
        suggestedRule,
        global: await loadGlobal(),
        repo: await loadRepo(targetRepoKey)
      })
      if (result.ok && !result.alreadyAllowed) {
        await writeAtomic(repoPath(targetRepoKey), serializePolicy(result.updatedRepo))
      }
      return result
    }
  }
}
