export const DEFAULT_SANDBOX_DISTRO = 'autosfactory'
export const TICKET_USER_PREFIX = 't-'
export const TICKET_USER_MARKER = 'af-ticket='

export function sandboxDistroFromEnv(env: Readonly<Record<string, string | undefined>>): string {
  const name = env.AUTOSFACTORY_WSL_DISTRO?.trim()
  return name ? name : DEFAULT_SANDBOX_DISTRO
}
