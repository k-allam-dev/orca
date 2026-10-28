import { describe, expect, it, vi } from 'vitest'

const postHogConstructor = vi.hoisted(() => vi.fn())

vi.mock('posthog-node', () => ({ PostHog: postHogConstructor }))

import type { Store } from '../persistence'
import { initTelemetry, isTelemetryEnabled, track } from '../telemetry/client'

// Why: our builds never get ORCA_POSTHOG_WRITE_KEY / ORCA_BUILD_IDENTITY, so Orca's own gate must keep telemetry dormant even for an opted-in profile.
describe('telemetry in a fork build without the CI write key', () => {
  it('never creates a PostHog client or transmits, even when the profile is opted in', () => {
    const store = {
      getSettings: () => ({
        telemetry: {
          optedIn: true,
          installId: '00000000-0000-4000-8000-000000000000',
          existedBeforeTelemetryRelease: false
        }
      })
    } as unknown as Store

    initTelemetry(store)

    expect(postHogConstructor).not.toHaveBeenCalled()
    expect(isTelemetryEnabled()).toBe(false)
    expect(track('app_opened', {} as never)).toBe(false)
    expect(postHogConstructor).not.toHaveBeenCalled()
  })
})
