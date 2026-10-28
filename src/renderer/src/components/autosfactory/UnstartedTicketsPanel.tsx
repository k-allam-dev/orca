import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAllWorktrees } from '@/store/selectors'
import { useMemo } from 'react'
import { refreshUnstartedData, useUnstartedData } from './unstarted-tickets-store'
import { selectUnstartedTickets, syncBannerFor } from './unstarted-tickets-model'

/** Slim Jira bar under the board header: the sync button and the sync banner. */
export function UnstartedTicketsPanel(): React.JSX.Element | null {
  const worktrees = useAllWorktrees()
  const data = useUnstartedData()
  const [syncing, setSyncing] = useState(false)
  const unstarted = useMemo(
    () => selectUnstartedTickets([...data.tickets], worktrees),
    [data.tickets, worktrees]
  )
  const banner = syncBannerFor(data.sync)

  const syncNow = async (): Promise<void> => {
    setSyncing(true)
    try {
      await window.api.autosfactory.syncNow()
      await refreshUnstartedData()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="shrink-0 border-b border-border text-sm" data-autosfactory-unstarted-panel="">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="font-medium">
          Jira: {unstarted.length} new {unstarted.length === 1 ? 'ticket' : 'tickets'} in the New
          column
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={syncing}
          onClick={() => void syncNow()}
        >
          {syncing ? 'Syncing...' : 'Sync now'}
        </Button>
      </div>
      {banner.kind !== 'none' ? (
        <div role="alert" className="mx-3 mb-2 rounded-md border border-border bg-muted px-2 py-1">
          <div>
            {banner.kind === 'not-connected'
              ? 'Jira is not connected. Connect Jira in Settings.'
              : banner.kind === 'token'
                ? `Jira token problem: ${banner.message}`
                : `Jira sync failed: ${banner.message}`}
          </div>
          <div className="text-muted-foreground">
            {banner.lastGoodSyncAt
              ? `Showing tickets from the last good sync at ${new Date(banner.lastGoodSyncAt).toLocaleString()}.`
              : 'No successful sync yet.'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
