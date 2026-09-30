import { useSyncExternalStore } from 'react'
import { getState, type PlayerState, subscribe } from './controller'
import { summarize } from './summary'

/** The whole player state; it changes several times a second while a book plays. */
export function usePlayer() {
  return useSyncExternalStore(subscribe, getState)
}

/**
 * One part of the player state, such as whether a book is loaded: the caller re-renders only
 * when that part changes, not with every tick of the position. `select` must return a value
 * that stays the same while nothing it reads changes, such as a field or a comparison.
 */
export function usePlayerValue<T>(select: (state: PlayerState) => T) {
  return useSyncExternalStore(subscribe, () => select(getState()))
}

/** The open book with where the listener is in it, or null when nothing is loaded. */
export function useNowPlaying() {
  const state = usePlayer()

  if (!state.book) {
    return null
  }

  return {
    ...state,
    book: state.book,
    summary: summarize(state.book, state.track, state.position, state.duration),
  }
}
