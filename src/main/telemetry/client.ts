// Fork build: telemetry is removed. Every export keeps its original name and signature so call sites stay untouched, but nothing
// is collected, stored or sent, and there is no transport (the posthog-node dependency is gone).

import type { EventName, EventProps, OptInVia } from '../../shared/telemetry-events'
import type { Store } from '../persistence'

export function initTelemetry(_store: Store): void {}

export function isTelemetryEnabled(): boolean {
  return false
}

export function hasTrackedAgentDashboardActiveToday(_props: unknown): boolean {
  return false
}

export function track<N extends EventName>(_name: N, _props: EventProps<N>): boolean {
  return false
}

export async function setOptIn(_via: OptInVia, _optedIn: boolean): Promise<void> {}

export async function persistBannerAcknowledgeWithoutEmitting(): Promise<void> {}

export function trackAppOpenedOnce(): void {}

export async function shutdownTelemetry(): Promise<void> {}

export function _enableTransportForTests(_enabled: boolean): void {}

export function _setShuttingDownForTests(_value: boolean): void {}

export function _resetFirstAppOpenedFiredForTests(): void {}
