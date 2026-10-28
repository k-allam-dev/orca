// Fork build: telemetry is removed, so consent is permanently off. Names and types are kept so callers stay untouched.

import type { GlobalSettings } from '../../shared/global-settings-types'
import type { TelemetryConsentState } from '../../shared/telemetry-consent-types'

export type ConsentState = TelemetryConsentState

export function _resetMisconfigWarnCacheForTests(): void {}

export function resolveConsent(_settings: GlobalSettings): ConsentState {
  return { effective: 'disabled', reason: 'orca_disabled' }
}
