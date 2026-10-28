import { useCallback, useEffect, useState } from 'react'
import type { TicketRecord, TicketState } from '../../../../shared/autosfactory/ticket-state'

export function replaceTicket(
  tickets: readonly TicketRecord[],
  next: TicketRecord
): TicketRecord[] {
  return tickets.map((ticket) => (ticket.key === next.key ? next : ticket))
}

export function useTicketBoard(): {
  tickets: TicketRecord[]
  error: string | null
  moveTicket: (key: string, state: TicketState) => void
} {
  const [tickets, setTickets] = useState<TicketRecord[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setTickets(await window.api.autosfactory.listTickets())
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const moveTicket = useCallback(
    (key: string, state: TicketState) => {
      // Why: show the card in its new column at once; the saved record then replaces the guess.
      setTickets((current) =>
        current.map((ticket) => (ticket.key === key ? { ...ticket, state } : ticket))
      )
      window.api.autosfactory.moveTicket({ key, state }).then(
        (saved) => setTickets((current) => replaceTicket(current, saved)),
        (moveError) => {
          void reload().then(() =>
            setError(moveError instanceof Error ? moveError.message : String(moveError))
          )
        }
      )
    },
    [reload]
  )

  return { tickets, error, moveTicket }
}
