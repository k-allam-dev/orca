import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Store } from '../persistence'
import {
  initTelemetry,
  isTelemetryEnabled,
  persistBannerAcknowledgeWithoutEmitting,
  setOptIn,
  shutdownTelemetry,
  track,
  trackAppOpenedOnce
} from '../telemetry/client'
import { resolveConsent } from '../telemetry/consent'

// Why: the fork removed telemetry; the exported functions stay as no-ops so call sites compile, and nothing may read or write settings.
describe('telemetry in the fork build', () => {
  const optedInSettings = {
    telemetry: {
      optedIn: true,
      installId: '00000000-0000-4000-8000-000000000000',
      existedBeforeTelemetryRelease: false
    }
  }

  it('does nothing and never touches the store, even for an opted-in profile', async () => {
    const touched: string[] = []
    const store = {
      getSettings: () => {
        touched.push('getSettings')
        return optedInSettings
      },
      updateSettings: () => {
        touched.push('updateSettings')
      }
    } as unknown as Store

    initTelemetry(store)
    expect(isTelemetryEnabled()).toBe(false)
    expect(track('app_opened', {} as never)).toBe(false)
    trackAppOpenedOnce()
    await setOptIn('settings', true)
    await persistBannerAcknowledgeWithoutEmitting()
    await shutdownTelemetry()

    expect(touched).toEqual([])
  })

  it('reports consent as disabled whatever the settings say', () => {
    expect(resolveConsent(optedInSettings as never).effective).toBe('disabled')
  })

  it('has no PostHog transport or dependency left', () => {
    const root = join(__dirname, '..', '..', '..')
    const pkg = readFileSync(join(root, 'package.json'), 'utf8')
    const client = readFileSync(join(root, 'src', 'main', 'telemetry', 'client.ts'), 'utf8')
    expect(pkg).not.toContain('posthog-node')
    expect(client).not.toMatch(/from 'posthog/)
  })
})
