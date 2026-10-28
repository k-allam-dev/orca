import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { PrivacyDiagnosticsSection } from './PrivacyDiagnosticsSection'

type PrivacyPaneProps = {
  settings: GlobalSettings
}

// Fork build: the usage-data toggle is removed with telemetry; only the diagnostics section remains.
export function PrivacyPane(_props: PrivacyPaneProps): React.JSX.Element {
  return (
    <div className="space-y-4">
      <PrivacyDiagnosticsSection />
    </div>
  )
}
