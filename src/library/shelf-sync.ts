import type {
  HardcoverRead,
  HardcoverShelfEntry,
  HardcoverShelfStatus,
} from '@/sources/hardcover/client'

/**
 * Keeping the library in step with the listener's Hardcover shelves. Hardcover is the source of
 * truth: what changed there since the last sync is applied here, even over changes made here
 * meanwhile. What changed only here is sent there. Nothing is ever deleted on Hardcover, and a
 * book taken off the shelves there leaves the library here without losing its listening.
 *
 * Which side changed is told by the baseline, what the shelves held after the last sync.
 */

/** What a book's shelf entry held after the last sync. */
export type ShelfBaseline = {
  userBookId: number
  status: HardcoverShelfStatus
  readId: number | null
  progressSeconds: number | null
  /** When the sync ended; listening saved here after it is newer than Hardcover's. */
  syncedAt: number
}

/** The book here: whether it is in the library, finished, and where listening stands. */
export type LocalBook = {
  inLibrary: boolean
  /** When it was finished, by hand or by hearing its recording to the end. */
  finishedAt: number | null
  /** When a recording of it last started playing. */
  playedAt: number | null
  listening: {
    /** Seconds into the recording. */
    seconds: number
    /** When the place was saved. */
    savedAt: number
    /** The recording's Hardcover edition, when it was matched to one. */
    editionId: number | null
    /** The recording's length, when every file's length is known. */
    recordingSeconds: number | null
  } | null
}

export type ShelfAction =
  /** Hardcover has the book on its shelves: put it in the library. */
  | { kind: 'addHere' }
  /** Hardcover has it read: mark it finished. */
  | { kind: 'finishHere' }
  /** Hardcover's read is elsewhere: move listening there, as a share of the recording. */
  | { kind: 'moveHere'; share: number | null; seconds: number }
  /**
   * Hardcover no longer has it read, with no place to move to: it is no longer finished here, and
   * starts again from the top, or from Hardcover's place once there is one.
   */
  | { kind: 'restartHere' }
  /** The book left Hardcover's shelves: take it out of the library, keeping its listening. */
  | { kind: 'leaveHere' }
  | { kind: 'addThere'; status: HardcoverShelfStatus }
  | { kind: 'statusThere'; status: HardcoverShelfStatus }
  /** Save listening in the open read, in seconds of the edition named. */
  | { kind: 'progressThere'; seconds: number; editionId: number | null }

/** Places closer than this are the same place, not worth a request or a move. */
const samePlaceSeconds = 30

function unchanged(remote: HardcoverShelfEntry, base: ShelfBaseline) {
  return (
    remote.userBookId === base.userBookId &&
    remote.status === base.status &&
    (remote.read?.id ?? null) === base.readId &&
    (remote.read?.progressSeconds ?? null) === base.progressSeconds
  )
}

/** How far through the book a read is, when its edition's length is known. */
function readShare(read: HardcoverRead) {
  return read.progressSeconds !== null && read.editionSeconds
    ? Math.min(1, read.progressSeconds / read.editionSeconds)
    : null
}

/**
 * Listening as Hardcover would hold it: in the recording's own edition when it has one, else in
 * the edition of the open read, by share when both lengths are known.
 */
export function remoteProgress(
  listening: NonNullable<LocalBook['listening']>,
  read: HardcoverRead | null,
) {
  if (listening.editionId !== null || !read) {
    return { seconds: listening.seconds, editionId: listening.editionId ?? read?.editionId ?? null }
  }

  const seconds =
    listening.recordingSeconds && read.editionSeconds
      ? (listening.seconds / listening.recordingSeconds) * read.editionSeconds
      : listening.seconds

  return { seconds, editionId: read.editionId }
}

/** Whether listening here and the read there stand at the same place. */
function samePlace(listening: LocalBook['listening'], read: HardcoverRead | null) {
  if (!listening || !read || read.progressSeconds === null) {
    return !listening && (read?.progressSeconds ?? null) === null
  }

  const share = readShare(read)

  if (share !== null && listening.recordingSeconds && listening.editionId !== read.editionId) {
    return Math.abs(share * listening.recordingSeconds - listening.seconds) < samePlaceSeconds
  }

  return Math.abs(read.progressSeconds - listening.seconds) < samePlaceSeconds
}

/** The status listening here amounts to. */
function localStatus(local: LocalBook): HardcoverShelfStatus {
  if (local.finishedAt !== null) {
    return 3
  }

  return local.playedAt !== null || local.listening ? 2 : 1
}

/**
 * Hardcover's entry, applied here. Listening here is moved, never forgotten. A book Hardcover
 * first links and only wants is left as it is here, since this phone knows more of it.
 */
function applyHere(
  remote: HardcoverShelfEntry,
  local: LocalBook | null,
  linked: boolean,
): ShelfAction[] {
  const actions: ShelfAction[] = []
  const finishedHere = (local?.finishedAt ?? null) !== null

  if (!local?.inLibrary) {
    actions.push({ kind: 'addHere' })
  }

  if (remote.status === 3) {
    if (!finishedHere) {
      actions.push({ kind: 'finishHere' })
    }
  } else if (
    remote.read &&
    remote.read.progressSeconds !== null &&
    !samePlace(local?.listening ?? null, remote.read)
  ) {
    actions.push({
      kind: 'moveHere',
      share: readShare(remote.read),
      seconds: remote.read.progressSeconds,
    })
  } else if (finishedHere && (!linked || remote.status !== 1)) {
    actions.push({ kind: 'restartHere' })
  }

  return actions
}

/** What only this phone knows of a book Hardcover has just linked, sent there. */
function fillThere(remote: HardcoverShelfEntry, local: LocalBook | null): ShelfAction[] {
  if (!local) {
    return []
  }

  const status = localStatus(local)

  // Hardcover knows more: a book it has started or finished keeps its place there.
  if (remote.status !== 1 || status === 1) {
    return remote.status === 2 && (remote.read?.progressSeconds ?? null) === null && local.listening
      ? [{ kind: 'progressThere', ...remoteProgress(local.listening, remote.read) }]
      : []
  }

  return [
    { kind: 'statusThere', status },
    ...(status === 2 && local.listening
      ? [{ kind: 'progressThere' as const, ...remoteProgress(local.listening, null) }]
      : []),
  ]
}

/** What changed here since the last sync, sent there. */
function sendThere(remote: HardcoverShelfEntry, since: number, local: LocalBook | null) {
  if (!local) {
    return []
  }

  const actions: ShelfAction[] = []
  const finished = local.finishedAt !== null && local.finishedAt > since
  const played = local.playedAt !== null && local.playedAt > since && local.finishedAt === null

  if (finished && remote.status !== 3) {
    return [{ kind: 'statusThere', status: 3 } satisfies ShelfAction]
  }

  if (played && remote.status !== 2) {
    actions.push({ kind: 'statusThere', status: 2 })
  }

  const listening = local.listening
  const reading = remote.status === 2 || actions.length > 0

  if (
    reading &&
    listening &&
    listening.savedAt > since &&
    local.finishedAt === null &&
    (actions.length > 0 || !samePlace(listening, remote.read))
  ) {
    // A read Hardcover opens with the status has no place yet; the one open now keeps its edition.
    actions.push({
      kind: 'progressThere',
      ...remoteProgress(listening, actions.length > 0 ? null : remote.read),
    })
  }

  return actions
}

/** A book only here, in the library: put on the shelves as far as it has got. */
function addThere(local: LocalBook): ShelfAction[] {
  const status = localStatus(local)

  return [
    { kind: 'addThere', status },
    ...(status === 2 && local.listening
      ? [{ kind: 'progressThere' as const, ...remoteProgress(local.listening, null) }]
      : []),
  ]
}

/** What to do for one book, from Hardcover's entry, the baseline and the book here. */
export function planShelf(
  remote: HardcoverShelfEntry | null,
  base: ShelfBaseline | null,
  local: LocalBook | null,
): ShelfAction[] {
  if (!remote) {
    if (base) {
      return local?.inLibrary ? [{ kind: 'leaveHere' }] : []
    }

    return local?.inLibrary ? addThere(local) : []
  }

  if (base && unchanged(remote, base)) {
    return sendThere(remote, base.syncedAt, local)
  }

  const linked = !base || base.userBookId !== remote.userBookId
  const here = applyHere(remote, local, linked)

  return linked ? [...here, ...fillThere(remote, local)] : here
}
