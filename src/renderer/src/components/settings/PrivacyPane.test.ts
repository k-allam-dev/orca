import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { PrivacyPane } from './PrivacyPane'

describe('PrivacyPane in the fork build', () => {
  it('renders no usage-data toggle, whatever the stored preference', () => {
    for (const optedIn of [true, false, null]) {
      const settings = { telemetry: { optedIn } } as unknown as GlobalSettings
      const markup = renderToStaticMarkup(React.createElement(PrivacyPane, { settings }))
      expect(markup).not.toContain('role="switch"')
    }
  })
})
