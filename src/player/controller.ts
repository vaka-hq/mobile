import { t } from '@lingui/core/macro'
import { requireOptionalNativeModule } from 'expo'
import {
  type AudioPlayer,
  type AudioStatus,
  createAudioPlayer,
  setAudioModeAsync,
} from 'expo-audio'
import { AppState } from 'react-native'
import { torBoxStatus } from '@/library/books'
import { displayAuthors, displayCover, displayTitle } from '@/library/display'
import { NotStreamableError } from '@/library/errors'
import { invalidateLibrary } from '@/library/invalidation'
import { type BookRecord, type Chapter, workIdOf } from '@/library/model'
import { offlineBook, offlineTrackUri } from '@/library/offline'
import {
  getBook,
  getPlayback,
  getWork,
  listRecentStreams,
  markPlayed,
  savePlayback,
  saveTrackDuration,
} from '@/library/repository'
import { isStreamUrlStale, streamUrl } from '@/library/streams'
import {
  bookDuration,
  bookPosition,
  chapterEnd,
  chapterIndexAt,
  knownPosition,
  locate,
  offsetPosition,
} from '@/library/timeline'
import { getPreferences, maxPlaybackSpeed, setPreference } from '@/settings/preferences'
import { chapterNumber } from '@/ui/format'

export type SleepTimer =
  | { kind: 'time'; endsAt: number; minutes: number }
  | { kind: 'chapter'; chapter: number }

export type PlayerState = {
  book: BookRecord | null
  track: number
  /** Seconds into the current track. */
  position: number
  /** Length of the current track once the player knows it. */
  duration: number | null
  playing: boolean
  /** Waiting for a stream link or for the stream to buffer. */
  loading: boolean
  speed: number
  sleep: SleepTimer | null
  /** Why playback stopped, shown in the full player; the UI words it for the listener. */
  error: Error | null
}

const initialState: PlayerState = {
  book: null,
  track: 0,
  position: 0,
  duration: null,
  playing: false,
  loading: false,
  speed: 1,
  sleep: null,
  error: null,
}

let state = initialState

const listeners = new Set<() => void>()

function update(patch: Partial<PlayerState>) {
  state = { ...state, ...patch }

  for (const listener of listeners) {
    listener()
  }
}

export function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function getState() {
  return state
}

/**
 * The one native player. Track changes swap its source so the media session stays alive; closing
 * releases it.
 */
let player: AudioPlayer | null = null

/** Which track the native player currently holds, and when its link was issued. */
let loaded: { bookId: string; track: number; fetchedAt: number; url: string } | null = null

/** expo-audio's native module, which Vaka's patch gives a disk cache for streamed audio. */
const nativeAudio = requireOptionalNativeModule<{
  prefetchRange?: (url: string, position: number, length: number) => Promise<void>
  streamCacheSize?: () => Promise<number>
  clearStreamCache?: () => Promise<void>
  setSkipIntervals?: (back: number, forward: number) => void
}>('ExpoAudio')

/** Makes the notification's and lock screen's skip buttons jump as far as the app's do. */
function applySkipIntervals() {
  const { skipBackSeconds, skipForwardSeconds } = getPreferences()

  nativeAudio?.setSkipIntervals?.(skipBackSeconds, skipForwardSeconds)
}

/** Bytes of streamed audio kept on disk; 0 on a build without the cache. */
export async function audioCacheSize() {
  return (await nativeAudio?.streamCacheSize?.()) ?? 0
}

/** Empties the disk cache of streamed audio; playback fetches what it needs again. */
export async function clearAudioCache() {
  await nativeAudio?.clearStreamCache?.()
}

/** How much audio before a new position is fetched, so skipping back from it is instant. */
const prefetchBehindSeconds = 120

/** How far past the position the fetch reaches, covering the estimate's error. */
const prefetchAheadSeconds = 20

/**
 * Fetches the audio just before `position` into the stream's disk cache. The player only
 * downloads forward from where it starts, so without this every skip back after a jump waits for
 * the network. Byte offsets are estimated from the file's size and length, which is close enough
 * for a generous window.
 */
function prefetchBehind(track: number, position: number) {
  // Skips in quick succession fetch once, for where they ended, not once for every step.
  if (prefetchTimer !== null) {
    clearTimeout(prefetchTimer)
  }

  prefetchTimer = setTimeout(() => {
    prefetchTimer = null
    prefetchNow(track, position)
  }, prefetchSettleMs)
}

/** How long skipping has to pause before the audio behind the new place is fetched. */
const prefetchSettleMs = 800

let prefetchTimer: ReturnType<typeof setTimeout> | null = null

function prefetchNow(track: number, position: number) {
  const book = state.book
  const size = book?.tracks?.[track]?.size
  const length = durations()[track] ?? (track === state.track ? state.duration : null)

  // A copy kept on the phone needs nothing fetched ahead of a jump.
  if (
    !loaded ||
    loaded.track !== track ||
    loaded.url.startsWith('file:') ||
    !size ||
    !length ||
    position <= 1
  ) {
    return
  }

  const bytesPerSecond = size / length
  const from = Math.max(0, position - prefetchBehindSeconds)
  const to = Math.min(length, position + prefetchAheadSeconds)

  void nativeAudio
    ?.prefetchRange?.(
      loaded.url,
      Math.floor(from * bytesPerSecond),
      Math.ceil((to - from) * bytesPerSecond),
    )
    .catch(() => undefined)
}

/** Increments per source load so a superseded link request never replaces a newer one. */
let generation = 0

/** The audio could not be played, as the native player reports it. */
export class PlaybackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlaybackError'
  }
}

/** The native player's status subscription, removed with the player. */
let subscription: { remove: () => void } | null = null

/** Counts calls to `open` and `close`; an `open` a newer call overtook stops where it is. */
let openToken = 0

/**
 * Status events already queued for the previous source can arrive after `replace`. They are
 * ignored until the new source reports itself unloaded (ExoPlayer masks it as buffering at once),
 * or after a short grace period.
 */
let settlingUntil = 0

/** Whether the listener wants sound, independent of buffering or a link being renewed. */
let wantsPlayback = false

/** The last `playing` value the native player reported, to notice notification play/pause. */
let reportedPlaying = false

/**
 * A seek the native player has not reported reaching yet. Status updates sent before it lands
 * still carry the old position; they are ignored until one arrives near the target, so the
 * slider and the saved position never jump back.
 */
let pendingSeek: { track: number; position: number; until: number } | null = null

/** The book reached its end; playing again starts over. */
let finished = false

let recoveries: number[] = []

let lastSavedAt = 0

/**
 * When the open book was last listened to: its saved place's time, then every save while it
 * plays. Kept apart from reading, which has its own place and time.
 */
let heardAt = 0

/** Where a book stands as playback is about to start, for the play gate to decide on. */
export type ListeningState = {
  /** When it was last listened to. */
  listenedAt: number
  /** Where it is, in seconds from its start; null when files before it have no known length. */
  seconds: number | null
}

/**
 * Asked before playback starts, such as where to listen from after the book was read further on:
 * false keeps playback from starting, true starts it where it is, and a place starts it there. A
 * book not yet open is asked about before it is loaded, so cancelling leaves the player as it was.
 */
export type PlayGate = (
  book: BookRecord,
  listening: ListeningState,
) => Promise<boolean | { track: number; position: number }>

let playGate: PlayGate | null = null

export function setPlayGate(gate: PlayGate | null) {
  playGate = gate
}

let sleepTimeout: ReturnType<typeof setTimeout> | null = null

let lastChapter = -1

function chapters() {
  return state.book?.chapters ?? []
}

function durations() {
  return state.book?.durations ?? state.book?.tracks?.map(() => null) ?? []
}

export function currentChapterIndex() {
  return chapterIndexAt(chapters(), state.track, state.position)
}

function lockScreenMetadata(book: BookRecord, chapter: Chapter | undefined) {
  const cover = displayCover(book)
  const title = displayTitle(book)
  const number = chapterNumber(chapter?.title)

  // A chapter titled only by a number, such as "001", reads "Chapter 1" as in the app.
  const chapterTitle =
    number !== null
      ? t({
          message: `Chapter ${number}`,
          comment: 'Name of a chapter without a title of its own, like “Chapter 3”',
        })
      : chapter?.title

  return {
    title: chapterTitle || title,
    artist: displayAuthors(book).join(', '),
    albumTitle: title,
    artworkUrl: cover ?? undefined,
  }
}

/** For writes the player can go on without: the next save or play writes them again. */
function ignoreFailure() {
  return undefined
}

/** The place last written, so a save that changes nothing writes nothing. */
let written: {
  bookId: string
  track: number
  position: number
  speed: number
  finished: boolean
} | null = null

/**
 * Writes the open book's place. Only a place that moved counts as listening: saves when the app
 * goes to the background or the speed changes leave the time it was last listened to alone, so
 * reading done since still counts as newer.
 */
async function persist() {
  const book = state.book

  if (!book) {
    return
  }

  const place = {
    bookId: book.id,
    track: state.track,
    position: state.position,
    speed: state.speed,
    finished,
  }

  const moved =
    written?.bookId !== place.bookId ||
    written.track !== place.track ||
    Math.abs(written.position - place.position) > 0.5 ||
    written.finished !== place.finished

  if (!moved && written?.speed === place.speed) {
    return
  }

  lastSavedAt = Date.now()

  if (moved) {
    heardAt = lastSavedAt
  }

  try {
    await savePlayback(place)
    written = place
  } catch {
    // The next save, seconds later or on pause, writes the place again.
    lastSavedAt = 0
  }
}

function ensurePlayer() {
  if (player) {
    return player
  }

  const created = createAudioPlayer(null, {
    updateInterval: 500,
    keepAudioSessionActive: true,
    // Several minutes ahead stay downloaded, so skipping forward rarely waits for the network.
    preferredForwardBufferDuration: 300,
  })

  // Events from a player already let go, which can still arrive, are ignored.
  subscription = created.addListener('playbackStatusUpdate', (status) => {
    if (player === created) {
      onStatus(status)
    }
  })
  player = created

  return created
}

export async function configureAudio() {
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
    shouldRouteThroughEarpiece: false,
  })
}

/**
 * Loads one file at a position. The previous source is paused and detached first, so its late
 * status events can never be taken for the new track's.
 */
async function loadTrack(track: number, position: number, freshUrl = false) {
  const opened = state.book

  if (!opened?.tracks?.[track]) {
    return
  }

  // A book kept on the phone plays its own copy, with or without a connection. Retrying a
  // stream, the torrent is looked up again first, as it may have been added anew since.
  const book = freshUrl && !offlineTrackUri(opened, track) ? await currentTorrent(opened) : opened
  const file = book.tracks?.[track]

  if (!file || state.book?.id !== book.id) {
    return
  }

  const local = offlineTrackUri(book, track)
  const torrentId = book.torrentId

  if (!local && torrentId === null) {
    update({ loading: false, playing: false, error: new NotStreamableError() })

    return
  }

  generation += 1

  const current = generation

  loaded = null
  player?.pause()
  update({ track, position, loading: true, error: null, duration: durations()[track] ?? null })

  try {
    const link =
      local || torrentId === null
        ? { url: local ?? '', fetchedAt: Number.POSITIVE_INFINITY }
        : await streamUrl(torrentId, file.fileId, freshUrl)

    // A newer load (another book, track or retry) superseded this one while the link was fetched.
    if (current !== generation || state.book?.id !== book.id) {
      return
    }

    const audio = ensurePlayer()

    settlingUntil = Date.now() + 1500
    reportedPlaying = false
    audio.replace({ uri: link.url, name: file.title })
    audio.setPlaybackRate(state.speed, 'high')
    // ExoPlayer accepts seeks while the new source buffers.
    void audio.seekTo(position)
    loaded = { bookId: book.id, track, fetchedAt: link.fetchedAt, url: link.url }
    prefetchBehind(track, position)
    // The metadata below already names this chapter; the media service binds asynchronously.
    lastChapter = currentChapterIndex()
    applySkipIntervals()
    audio.setActiveForLockScreen(
      true,
      lockScreenMetadata(book, chapters()[currentChapterIndex()]),
      {
        showSeekBackward: true,
        showSeekForward: true,
      },
    )

    if (wantsPlayback) {
      audio.play()
    } else {
      update({ loading: false })
    }
  } catch (error) {
    if (current === generation) {
      // A failed load stops wanting playback, so a later seek does not start it unasked.
      wantsPlayback = false
      update({
        loading: false,
        playing: false,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }
}

/**
 * The book with its torrent as TorBox has it now: one added again since the book was opened, or
 * found again by its hash, replaces the one the player had, with its files. Should TorBox not
 * answer, the book is kept as it was and the link request says what went wrong.
 */
async function currentTorrent(book: BookRecord) {
  try {
    const status = await torBoxStatus(book)
    const stored = status.kind === 'ready' ? await getBook(book.id) : null

    if (stored?.tracks && stored.torrentId !== book.torrentId && state.book?.id === book.id) {
      update({ book: stored })

      return stored
    }
  } catch {
    // Kept as it was; the link request that follows reports the failure.
  }

  return book
}

/**
 * Expired or revoked links surface as player errors. Re-request the link and resume from the
 * last known position, at most three times a minute so a truly broken file stops retrying.
 */
function recover(message: string) {
  const now = Date.now()

  recoveries = recoveries.filter((time) => now - time < 60_000)

  if (recoveries.length >= 3 || !state.book) {
    wantsPlayback = false
    update({ loading: false, playing: false, error: new PlaybackError(message) })

    return
  }

  recoveries.push(now)
  void loadTrack(state.track, state.position, true)
}

function onStatus(status: AudioStatus) {
  const audio = player
  const book = state.book

  if (!audio || !book || !loaded || loaded.bookId !== book.id || loaded.track !== state.track) {
    return
  }

  if (settlingUntil > 0) {
    if (status.isLoaded && Date.now() < settlingUntil) {
      return
    }

    settlingUntil = 0
  }

  if (status.error) {
    // The player is idle after an error and needs a new source, not just `play()`.
    loaded = null
    recover(status.error)

    return
  }

  const ended = status.didJustFinish || status.playbackState === 'ended'

  // Play and pause from the notification, lock screen or audio focus bypass `play()`/`pause()`.
  // Reaching the end of a file also reports "not playing", which is not the listener pausing,
  // and so does buffering after a seek.
  if (
    status.isLoaded &&
    !ended &&
    !status.isBuffering &&
    pendingSeek === null &&
    status.playing !== reportedPlaying
  ) {
    reportedPlaying = status.playing
    wantsPlayback = status.playing

    if (!status.playing) {
      void persist().then(invalidateLibrary)
    }
  }

  if (status.duration > 0 && durations()[state.track] !== status.duration) {
    const measured = [...durations()]

    if (
      measured[state.track] === null ||
      Math.abs((measured[state.track] ?? 0) - status.duration) >= 1
    ) {
      measured[state.track] = status.duration
      update({ book: { ...book, durations: measured } })
      void saveTrackDuration(book.id, state.track, status.duration).catch(ignoreFailure)
    }
  }

  if (pendingSeek) {
    const reached =
      pendingSeek.track === state.track &&
      status.isLoaded &&
      Math.abs(status.currentTime - pendingSeek.position) < 2

    if (reached || Date.now() > pendingSeek.until) {
      pendingSeek = null
    }
  }

  update({
    // Before the new source is ready its position is 0, and before a seek lands it is the old
    // one; neither is where playback is heading.
    position: status.isLoaded && !pendingSeek ? status.currentTime : state.position,
    duration: status.duration > 0 ? status.duration : state.duration,
    playing: status.playing,
    loading: status.isBuffering && wantsPlayback,
  })

  if (status.didJustFinish) {
    // A chapter timer whose chapter ends with this file stops here instead of in the next one.
    if (state.sleep?.kind === 'chapter') {
      update({ sleep: null })
      wantsPlayback = false
    }

    void advanceTrack().catch(ignoreFailure)

    return
  }

  onProgress()
}

/** Chapter changes update the notification; the chapter sleep timer stops at its end. */
function onProgress() {
  const book = state.book

  if (!book) {
    return
  }

  const chapter = currentChapterIndex()

  if (chapter !== lastChapter) {
    lastChapter = chapter
    player?.updateLockScreenMetadata(lockScreenMetadata(book, chapters()[chapter]))
  }

  // Timers do not run while the screen is off, but status updates do.
  if (state.sleep?.kind === 'time' && Date.now() >= state.sleep.endsAt) {
    clearSleepTimer()
    update({ sleep: null })
    pause()
  }

  if (state.sleep?.kind === 'chapter') {
    const end = chapterEnd(chapters(), state.sleep.chapter, durations())
    const sleepTrack = chapters()[state.sleep.chapter]?.track ?? state.track
    // Updates arrive every half second of real time, so faster speeds cover more audio.
    const margin = 0.6 * Math.max(1, state.speed)

    if (
      chapter > state.sleep.chapter ||
      state.track > sleepTrack ||
      (end !== null && state.track === sleepTrack && state.position >= end - margin)
    ) {
      update({ sleep: null })
      pause()
    }
  }

  if (state.playing && Date.now() - lastSavedAt > 5000) {
    void persist()
  }
}

async function advanceTrack() {
  const book = state.book
  const next = state.track + 1

  if (!book?.tracks) {
    return
  }

  if (next < book.tracks.length) {
    await loadTrack(next, 0)

    return
  }

  wantsPlayback = false
  finished = true
  update({ playing: false, position: state.duration ?? state.position })
  player?.pause()
  await persist()
  invalidateLibrary()
}

/** Opens a book at its saved position without touching the network until playback starts. */
/** Resolves false when it was to play but the listener chose not to start. */
export async function open(bookId: string, autoplay: boolean): Promise<boolean> {
  const token = ++openToken
  const book = await getBook(bookId)

  // A book kept on the phone opens without a stream to play from.
  if (!book?.tracks || (book.torrentId === null && offlineBook(bookId)?.status !== 'done')) {
    throw new NotStreamableError()
  }

  if (token !== openToken) {
    return false
  }

  // Opening a book on purpose undoes an earlier close.
  if (getPreferences().closedBookId) {
    void setPreference('closedBookId', '').catch(ignoreFailure)
  }

  if (state.book?.id === bookId) {
    update({ book })

    return autoplay ? askThenPlay(book) : true
  }

  const saved = await getPlayback(bookId)

  // Another book was opened, or the player closed, while this one was being read.
  if (token !== openToken) {
    return false
  }

  const restart = saved?.finished ?? false
  let track = restart ? 0 : Math.min(saved?.track ?? 0, book.tracks.length - 1)
  let position = restart ? 0 : (saved?.position ?? 0)

  // Asked before the book is loaded, so cancelling leaves the player, and any book in it, as it
  // was; a place chosen is where the book opens.
  if (autoplay && playGate) {
    const answer = await playGate(
      book,
      listeningState(book, track, position, saved?.updatedAt ?? book.lastPlayedAt ?? 0),
    ).catch(() => true)

    if (answer === false || token !== openToken) {
      return false
    }

    if (answer !== true) {
      track = Math.max(0, Math.min(answer.track, book.tracks.length - 1))
      position = Math.max(0, answer.position)
    }
  }

  await persist()

  if (token !== openToken) {
    return false
  }

  wantsPlayback = false
  player?.pause()

  heardAt = saved?.updatedAt ?? book.lastPlayedAt ?? 0
  written = saved
    ? {
        bookId,
        track: saved.track,
        position: saved.position,
        speed: saved.speed,
        finished: saved.finished,
      }
    : null

  generation += 1
  loaded = null
  pendingSeek = null
  finished = false
  lastChapter = -1
  recoveries = []
  clearSleepTimer()

  update({
    ...initialState,
    book,
    track,
    position,
    speed: Math.min(maxPlaybackSpeed, saved?.speed ?? getPreferences().defaultSpeed),
    duration: book.durations?.[track] ?? null,
  })

  if (autoplay) {
    play(true)
  }

  return true
}

/** Keeps the open book's metadata current after chapters or Hardcover details change. */
export async function refreshBook(bookId: string) {
  if (state.book?.id !== bookId) {
    return
  }

  const book = await getBook(bookId)

  if (book) {
    update({ book })
  }
}

/** What the play gate is told about a book at a place. */
function listeningState(
  book: BookRecord,
  track: number,
  position: number,
  at: number,
): ListeningState {
  const lengths = book.durations ?? book.tracks?.map(() => null) ?? []

  return { listenedAt: at, seconds: knownPosition(lengths, track, position) }
}

/**
 * Asks the play gate about the open book, then starts playback if it agrees and the book is still
 * the open one, at the place it chose if it chose one; resolves whether it started.
 */
async function askThenPlay(book: BookRecord) {
  const gate = playGate

  const answer = gate
    ? await gate(book, listeningState(book, state.track, state.position, heardAt)).catch(() => true)
    : true

  if (answer === false || state.book?.id !== book.id) {
    return false
  }

  if (answer !== true) {
    await seekTo(answer.track, answer.position)
  }

  play(true)

  return true
}

/** Starts playback; with `asked`, the play gate has already had its say. */
export function play(asked = false) {
  const book = state.book

  if (!book) {
    return
  }

  if (!asked && playGate) {
    void askThenPlay(book)

    return
  }

  wantsPlayback = true
  void markPlayed(book.id).then(invalidateLibrary).catch(ignoreFailure)

  if (finished) {
    finished = false
    void loadTrack(0, 0)

    return
  }

  // A link issued long ago may lapse mid-stream; reload at the same position before resuming.
  if (
    !player ||
    !loaded ||
    loaded.bookId !== book.id ||
    loaded.track !== state.track ||
    isStreamUrlStale(loaded.fetchedAt)
  ) {
    void loadTrack(state.track, state.position)

    return
  }

  update({ error: null })
  player.play()
}

export function pause() {
  wantsPlayback = false
  player?.pause()
  update({ playing: false })
  void persist().then(invalidateLibrary)
}

/** Pauses and waits for the place to be saved, such as before reading on from it. */
export async function pauseAndSave() {
  wantsPlayback = false
  player?.pause()
  update({ playing: false })
  await persist()
  invalidateLibrary()
}

export function togglePlay() {
  // What the listener asked for decides, not what the player reports: while a stream is still
  // loading it is not yet playing, but a tap then means pause.
  if (wantsPlayback || state.playing || state.loading) {
    pause()
  } else {
    play()
  }
}

/** Seeks within the book, loading another file when the target lies in it. */
export async function seekTo(track: number, position: number) {
  const book = state.book

  if (!book?.tracks) {
    return
  }

  const target = Math.max(0, Math.min(track, book.tracks.length - 1))
  const clamped = Math.max(0, position)

  lastChapter = -1
  finished = false
  pendingSeek = { track: target, position: clamped, until: Date.now() + 5000 }

  if (target !== state.track || !loaded || loaded.track !== target || loaded.bookId !== book.id) {
    await loadTrack(target, clamped)
  } else {
    update({ position: clamped })
    await player?.seekTo(clamped)
    prefetchBehind(target, clamped)
  }

  // "End of chapter" means the chapter the listener lands in.
  if (state.sleep?.kind === 'chapter') {
    update({ sleep: { kind: 'chapter', chapter: currentChapterIndex() } })
  }

  void persist()
}

export async function seekBy(seconds: number) {
  const target = offsetPosition(durations(), state.track, state.position, seconds)

  await seekTo(target.track, target.position)
}

export async function skipChapter(direction: 1 | -1) {
  const list = chapters()
  const index = currentChapterIndex()
  const chapter = list[index]

  if (
    direction === -1 &&
    chapter &&
    state.track === chapter.track &&
    state.position - chapter.start > 3
  ) {
    await seekTo(chapter.track, chapter.start)

    return
  }

  const next = list[index + direction]

  if (next) {
    await seekTo(next.track, next.start)
  }
}

export function setSpeed(value: number) {
  const speed = Math.min(maxPlaybackSpeed, Math.max(0.5, value))

  player?.setPlaybackRate(speed, 'high')
  update({ speed })
  void persist()
}

function clearSleepTimer() {
  if (sleepTimeout) {
    clearTimeout(sleepTimeout)
    sleepTimeout = null
  }
}

/** Minutes from now, the end of the current chapter, or null to cancel. */
export function setSleepTimer(minutes: number | 'chapter' | null) {
  clearSleepTimer()

  if (minutes === null) {
    update({ sleep: null })

    return
  }

  if (minutes === 'chapter') {
    update({ sleep: { kind: 'chapter', chapter: currentChapterIndex() } })

    return
  }

  const endsAt = Date.now() + minutes * 60_000

  sleepTimeout = setTimeout(() => {
    sleepTimeout = null
    update({ sleep: null })
    pause()
  }, minutes * 60_000)

  update({ sleep: { kind: 'time', endsAt, minutes } })
}

/**
 * Stops playback and releases the media session and its notification. The book is not restored
 * into the mini player on the next launch; playing it, or another book, brings the player back.
 */
export async function close() {
  const closedId = state.book?.id ?? ''

  openToken += 1

  // The player is let go even if saving the place fails.
  await persist().catch(() => undefined)
  clearSleepTimer()
  wantsPlayback = false
  generation += 1
  // Released rather than kept: while a player stays bound to the media service, Android keeps its
  // notification. The next book creates a new one.
  const released = player

  player = null
  pendingSeek = null
  released?.pause()
  released?.clearLockScreenControls()
  released?.remove()
  subscription?.remove()
  subscription = null
  // Frees the native player and its media session now rather than whenever it is collected.
  released?.release()
  loaded = null
  update(initialState)
  invalidateLibrary()
  await setPreference('closedBookId', closedId)
}

/**
 * Moves the open book to another recording of it, such as a better upload, keeping the listener's
 * place and speed: it starts at the same point in the book once its length is known, else where
 * it was last left. Playback carries on if it was playing.
 */
export async function switchStream(bookId: string) {
  const previous = state.book

  if (!previous || previous.id === bookId) {
    return
  }

  const wasPlaying = wantsPlayback
  const { speed } = state
  const played = durations()

  // The place carries over only when the tracks before it have known lengths, or it would land
  // short of where the listener was.
  const elapsed = played.slice(0, state.track).every((duration) => duration !== null)
    ? bookPosition(played, state.track, state.position)
    : null

  await open(bookId, false)
  setSpeed(speed)

  const next = state.book
  const lengths = next?.durations ?? null
  const measured = lengths !== null && (lengths.length === 1 || bookDuration(lengths) !== null)

  if (next && measured && elapsed !== null) {
    const target = locate(lengths, elapsed)

    await seekTo(target.track, target.position)
  }

  // Playback carries on in the other recording; nothing is asked.
  if (wasPlaying) {
    play(true)
  }
}

/** Stops the player when it holds a stream of `workId`, such as a book leaving the library. */
export async function closeWork(workId: string) {
  if (state.book && workIdOf(state.book) === workId) {
    await close()
  }
}

let started = false

/** Restores the last book, paused, so the mini player is ready after a cold start. */
export async function startPlayer() {
  if (started) {
    return
  }

  started = true

  try {
    await configureAudio()
  } catch (error) {
    // Tried again on the next start rather than never; the book is not restored without audio.
    started = false
    throw error
  }

  AppState.addEventListener('change', (next) => {
    if (next !== 'active') {
      void persist()
    }
  })

  const [recent] = await listRecentStreams(1)
  // A book removed from the library is not brought back into the mini player.
  const work = recent ? await getWork(workIdOf(recent.book)) : null

  // A book kept on the phone comes back even without its TorBox torrent, as it plays from there.
  if (
    recent?.book.tracks &&
    (recent.book.torrentId !== null || offlineBook(recent.book.id)?.status === 'done') &&
    !recent.playback?.finished &&
    work?.inLibrary &&
    recent.book.id !== getPreferences().closedBookId
  ) {
    await open(recent.book.id, false).catch(() => undefined)
  }
}
