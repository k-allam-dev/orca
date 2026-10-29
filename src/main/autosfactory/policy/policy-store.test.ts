import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { baselineRules } from '../../../shared/autosfactory/permission-policy'
import { createPolicyStore } from './policy-store'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'af-policy-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const own = { ticketRepoKey: 'orca', targetRepoKey: 'orca' }

describe('policy store', () => {
  it('writes the baseline as the global file on first load so the user can edit it', async () => {
    const store = createPolicyStore(dir)
    expect(await store.loadGlobal()).toEqual(baselineRules())
    expect(JSON.parse(await readFile(store.globalPath(), 'utf8')).deny).toContain('Bash(rm -rf *)')
    expect(store.globalPath()).toContain(join('autosfactory', 'policy'))
  })

  it('fails closed with a readable error on a broken file', async () => {
    const store = createPolicyStore(dir)
    await mkdir(join(dir, 'autosfactory', 'policy'), { recursive: true })
    await writeFile(store.globalPath(), '{"allow":["Sudo(x)"]}')
    await expect(store.loadGlobal()).rejects.toThrow(/unknown tool "Sudo"/)
  })

  it('promotes into the ticket repo file only and keeps the deny list out of reach', async () => {
    const store = createPolicyStore(dir)
    const ok = await store.promoteCommand({ ...own, command: 'make test' })
    expect(ok.ok).toBe(true)
    expect((await store.loadRepo('orca')).allow).toEqual(['Bash(make test)'])
    expect((await store.loadRepo('other')).allow).toEqual([])

    const wildcard = await store.promoteCommand({
      ...own,
      command: 'curl x',
      suggestedRule: 'Bash(curl *)'
    })
    const destructive = await store.promoteCommand({ ...own, command: 'rm -rf /' })
    const crossRepo = await store.promoteCommand({
      ticketRepoKey: 'orca',
      targetRepoKey: 'other',
      command: 'make lint'
    })
    expect([wildcard.ok, destructive.ok, crossRepo.ok]).toEqual([false, false, false])
    expect((await store.loadRepo('orca')).allow).toEqual(['Bash(make test)'])
    await expect(readFile(store.repoPath('other'), 'utf8')).rejects.toThrow()
  })

  it('merges the repo file with the global one and rejects hostile repo keys', async () => {
    const store = createPolicyStore(dir)
    await store.promoteCommand({ ...own, command: 'make test' })
    const effective = await store.loadEffective('orca')
    expect(effective.merged.allow).toContain('Bash(make test)')
    expect(effective.global.allow).not.toContain('Bash(make test)')
    expect(() => store.repoPath('../x')).toThrow()
  })
})
