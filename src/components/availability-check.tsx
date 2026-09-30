import { useEffect, useRef, useState } from 'react'
import { AvailabilityDialog } from '@/ui/dialogs'

/** What the check dialog says: while checking, and when the source seems unavailable. */
export type AvailabilityTexts = {
  checkingTitle: string
  checkingMessage: string
  deadTitle: string
  deadMessage: string
  continueLabel: string
}

type Asking = { phase: 'checking' | 'dead'; texts: AvailabilityTexts; go: () => void }

/**
 * Checks that a source can still be had before going on with it. `confirm` goes on at once for a
 * source known to be available, asks straight away for one known to be dead, and otherwise shows
 * a spinner while `check` looks it up: available, it goes on; dead, the dialog asks whether to go
 * on anyway. A check that fails to answer goes on, as nothing says the source is gone. Cancel,
 * or leaving the screen, stops the check. `dialog` goes in the screen's tree.
 */
export function useAvailabilityCheck() {
  const [asking, setAsking] = useState<Asking | null>(null)
  const running = useRef<AbortController | null>(null)

  function stop() {
    running.current?.abort()
    running.current = null
  }

  useEffect(() => stop, [])

  function confirm({
    known,
    check,
    texts,
    go,
  }: {
    /** What is already known of the source: available, dead, or null when it must be checked. */
    known: boolean | null
    /** Looks the source up; resolves true when it can be had. */
    check: (signal: AbortSignal) => Promise<boolean>
    texts: AvailabilityTexts
    go: () => void
  }) {
    if (known === true) {
      go()

      return
    }

    if (known === false) {
      setAsking({ phase: 'dead', texts, go })

      return
    }

    stop()
    const controller = new AbortController()

    running.current = controller
    setAsking({ phase: 'checking', texts, go })

    void check(controller.signal)
      .catch(() => true)
      .then((available) => {
        if (controller.signal.aborted) {
          return
        }

        running.current = null

        if (available) {
          setAsking(null)
          go()
        } else {
          setAsking({ phase: 'dead', texts, go })
        }
      })
  }

  const dialog = asking ? (
    <AvailabilityDialog
      phase={asking.phase}
      {...asking.texts}
      onContinue={() => {
        setAsking(null)
        asking.go()
      }}
      onCancel={() => {
        stop()
        setAsking(null)
      }}
    />
  ) : null

  return { confirm, dialog }
}
