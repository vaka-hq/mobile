/** Work stopped because its signal was aborted. */
export class AbortedError extends Error {
  constructor() {
    super('Stopped')
    this.name = 'AbortedError'
  }
}

/**
 * Throws once `signal` is aborted. React Native's AbortSignal has no `throwIfAborted`, though the
 * DOM types declare it, so calling that fails on the phone; use this instead.
 */
export function stopIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new AbortedError()
  }
}
