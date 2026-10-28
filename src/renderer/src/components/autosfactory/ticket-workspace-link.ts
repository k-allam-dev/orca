import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'

type KnownWorktree = { id: string; path: string }

function knownWorktrees(): KnownWorktree[] {
  return Object.values(useAppStore.getState().worktreesByRepo).flat()
}

export function activeWorktreePath(): string | null {
  const activeId = useAppStore.getState().activeWorktreeId
  return knownWorktrees().find((worktree) => worktree.id === activeId)?.path ?? null
}

export function openWorktreeTerminalByPath(path: string): boolean {
  const worktree = knownWorktrees().find((candidate) => candidate.path === path)
  return worktree ? activateAndRevealWorktree(worktree.id) !== false : false
}
