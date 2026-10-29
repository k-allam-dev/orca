export const DEFAULT_SANDBOX_DISTRO = 'autosfactory'
export const TICKET_USER_PREFIX = 't-'
export const TICKET_USER_MARKER = 'af-ticket='
export const SHARED_REPOS_DIR = '/srv/autosfactory/repos'
export const SHARED_REPOS_USER = 'afrepos'
export const SANDBOX_BASE_BRANCH = 'develop'
export const UPDATE_REPO_SCRIPT_PATH = '/usr/local/lib/autosfactory/update-repo.sh'

export function sandboxDistroFromEnv(env: Readonly<Record<string, string | undefined>>): string {
  const name = env.AUTOSFACTORY_WSL_DISTRO?.trim()
  return name ? name : DEFAULT_SANDBOX_DISTRO
}
export const CLAUDE_MANAGED_SETTINGS_PATH = '/etc/claude-code/managed-settings.json'
export const TICKET_POLICY_DIR = '/etc/autosfactory/policy'
