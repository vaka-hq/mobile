import { getState, open, play, seekTo } from './controller'

/** Plays a book from a position, opening it first when another book is loaded. */
export async function playFrom(bookId: string, track: number, position: number) {
  if (getState().book?.id !== bookId) {
    await open(bookId, false)
  }

  await seekTo(track, position)

  play()
}
