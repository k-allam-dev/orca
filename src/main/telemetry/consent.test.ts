import { describe, it, expect } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { resolveConsent } from './consent'

describe('resolveConsent in the fork build', () => {
  it.each([true, false, null])('is disabled even when the profile has optedIn=%s', (optedIn) => {
    const settings = {
      telemetry: { optedIn, installId: 'x', existedBeforeTelemetryRelease: false }
    } as unknown as GlobalSettings
    expect(resolveConsent(settings)).toEqual({ effective: 'disabled', reason: 'orca_disabled' })
  })

  it('is disabled when the profile has no telemetry block', () => {
    expect(resolveConsent({} as unknown as GlobalSettings).effective).toBe('disabled')
  })
})
