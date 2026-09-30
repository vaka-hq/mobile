import { useLingui } from '@lingui/react/macro'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { useAvailabilityCheck } from '@/components/availability-check'
import { useCancelDownloadPrompt } from '@/components/cancel-download'
import { SourceInfoSheet } from '@/components/source-info'
import { workIdOf } from '@/library/model'
import {
  fetchSwarm,
  useAddedDownloads,
  useTorBoxDownloads,
  useTorrentSwarms,
  useWorkStreams,
} from '@/library/queries'
import { type NarratorGroup, releaseNotes } from '@/library/recordings'
import { usePlayerValue } from '@/player/use-player'
import { useTorBoxKey } from '@/settings/torbox-key'
import type { AbbBook } from '@/sources/audiobookbay/parse'
import { useLabels } from '@/ui/labels'
import { Empty, Group, type GroupRow, List, Loading, Notice } from '@/ui/primitives'
import { Action, Screen } from '@/ui/screen'

function useGroupCaption() {
  const labels = useLabels()

  return (group: NarratorGroup) => {
    const recording = group.recording
    const language = recording?.language ?? group.posts[0]?.language ?? null

    return [
      recording?.publisher,
      recording?.releaseDate?.slice(0, 4),
      recording?.durationSeconds ? labels.duration(recording.durationSeconds) : null,
      language,
    ]
      .filter(Boolean)
      .join(' · ')
  }
}

/**
 * Every recording of a book on AudioBookBay, grouped by narrator with the best source first.
 * Choosing one makes it the book's stream and returns to the book. Uploads being downloaded show
 * their progress and can be cancelled here. Uploads that would need downloading can be checked for
 * seeders from the app bar, and a dead one is marked; one not checked yet is checked when chosen,
 * and a dead one is chosen only after a warning. Holding any upload shows its details.
 */
export function WorkStreamsScreen() {
  const { t } = useLingui()
  const router = useRouter()
  const labels = useLabels()
  const caption = useGroupCaption()
  const { id } = useLocalSearchParams<{ id: string }>()

  const { workId, recordings, groups, settled, selectedId, choose } = useWorkStreams(
    Number(id),
    null,
  )

  const playing = usePlayerValue((state) => state.book)
  // While the book plays, picking here changes the source it plays from.
  const changing = playing !== null && workIdOf(playing) === workId
  const cancelPrompt = useCancelDownloadPrompt()
  const listings = recordings.listings
  const apiKey = useTorBoxKey()
  // Every visit starts with only the uploads that play right away; the app bar shows the rest.
  const [hideUncachedStreams, setHideUncachedStreams] = useState(true)
  const cached = recordings.cached
  const posts = groups.flatMap((group) => group.posts)
  const downloads = useTorBoxDownloads(posts.map((post) => post.infoHash)).data

  const [info, setInfo] = useState<{ post: AbbBook; title: string } | null>(null)
  // Uploads are checked for seeders only when asked, from the app bar or by choosing one.
  const [checkAll, setCheckAll] = useState(false)
  const availability = useAvailabilityCheck()

  const deadTexts = {
    checkingTitle: t({ message: 'Checking the source', comment: 'Dialog title' }),
    checkingMessage: t({
      message: 'Checking if it’s available…',
      comment: 'Shown while a source or file is checked before it is chosen',
    }),
    deadTitle: t({ message: 'This source is probably dead', comment: 'Dialog title' }),
    deadMessage: t({
      message: 'No one is sharing it, so it may never download.',
      comment: 'Warning before choosing an upload whose torrent has no seeders',
    }),
    continueLabel: t({ message: 'Choose anyway', comment: 'Chooses a dead upload' }),
  }

  function choosePost(postId: string) {
    choose.mutate(postId)
    router.back()
  }

  const added = useAddedDownloads(recordings.books)

  /** How far TorBox has got with an upload, from 0 to 1, or null when it is not downloading. */
  function downloadProgress(postId: string, infoHash: string) {
    const status = added.get(postId)

    if (status) {
      return status.kind === 'downloading' ? status.progress : null
    }

    const download = downloads?.get(infoHash.toLowerCase())

    return download && !download.finished ? download.progress : null
  }

  const cachedCount = posts.filter((post) => cached?.has(post.infoHash.toLowerCase())).length

  // The filter only has something to do when some uploads are cached and some are not. Until
  // TorBox has answered, nothing is hidden rather than everything.
  const canFilter =
    Boolean(apiKey) && cached !== null && cachedCount > 0 && cachedCount < posts.length

  const filtering = canFilter && hideUncachedStreams

  // Shown uploads that would have to be downloaded, which can be checked for seeders; one with
  // none is dead.
  const uncached =
    cached === null || filtering
      ? []
      : posts.filter((post) => !cached.has(post.infoHash.toLowerCase()))

  const swarms = useTorrentSwarms(uncached, checkAll)

  // The app bar offers to check them while any is still unknown and none is being checked.
  const uncheckedLeft =
    Boolean(apiKey) &&
    !checkAll &&
    uncached.some((post) => swarms.get(post.infoHash.toLowerCase())?.swarm === undefined)

  const shown = groups.flatMap((group) => {
    const posts = filtering
      ? group.posts.filter((post) => cached?.has(post.infoHash.toLowerCase()))
      : group.posts

    return posts.length > 0 ? [{ ...group, posts }] : []
  })

  function rowsOf(group: NarratorGroup): GroupRow[] {
    return group.posts.map((post) => {
      const progress = downloadProgress(post.id, post.infoHash)
      const percent = progress === null ? null : Math.round(progress * 100)
      const hash = post.infoHash.toLowerCase()
      const state = swarms.get(hash)
      const checking = state?.checking === true
      const dead = state?.swarm?.dead === true

      const label =
        [
          post.format,
          post.bitrate,
          post.abridged === true
            ? t({ message: 'Abridged', comment: 'Edition is shortened' })
            : null,
        ]
          .filter(Boolean)
          .join(' · ') || post.title

      return {
        key: post.id,
        label,
        value: [
          percent !== null
            ? t({
                message: `Downloading ${percent}%`,
                comment: 'Source row while TorBox downloads the upload, like “Downloading 42%”',
              })
            : null,
          releaseNotes(post.title),
          post.totalSize,
          post.postedAt,
        ]
          .filter(Boolean)
          .join(' · '),
        selected: post.id === selectedId,
        badge: recordings.cached?.has(post.infoHash.toLowerCase())
          ? {
              glyph: 'cached' as const,
              description: t({
                message: 'Plays right away',
                comment: 'Marks an upload that is already cached and streams at once',
              }),
            }
          : dead
            ? {
                glyph: 'dead' as const,
                description: t({
                  message: 'Probably dead: no one is sharing it',
                  comment: 'Marks an upload whose torrent has no seeders',
                }),
                warning: true,
              }
            : undefined,
        action:
          percent !== null
            ? {
                glyph: 'clear' as const,
                description: t({ message: 'Cancel download', comment: 'Stops a TorBox download' }),
                onPress: () => cancelPrompt.ask(post.id),
              }
            : undefined,
        pending: checking && percent === null,
        // One that would need downloading is checked first unless it has been, and a dead one is
        // chosen only after a warning, since it will most likely never download.
        onPress: () =>
          availability.confirm({
            known:
              !state || post.id === selectedId || !apiKey
                ? true
                : state.swarm === undefined
                  ? null
                  : !state.swarm?.dead,
            check: async (signal) => !(await fetchSwarm(post, signal))?.dead,
            texts: deadTexts,
            go: () => choosePost(post.id),
          }),
        onLongPress: () => setInfo({ post, title: label }),
      }
    })
  }

  return (
    <Screen
      title={
        changing
          ? t({
              message: 'Change audiobook',
              comment: 'Title of the recording list while the book is playing',
            })
          : t({
              message: 'Select audiobook',
              comment: 'Title of the screen choosing which recording and upload of a book to play',
            })
      }
      navigation='back'
      actions={
        <>
          {uncheckedLeft ? (
            <Action
              glyph='checkSources'
              label={t({
                message: 'Check sources',
                comment: 'App bar button checking which uploads are still being shared',
              })}
              onPress={() => setCheckAll(true)}
            />
          ) : null}
          {/* The icon shows what is listed: a bolt for uploads that stream instantly, a stack for
              all. It swaps rather than the button changing state, which removes app bar buttons. */}
          {canFilter ? (
            <Action
              glyph={hideUncachedStreams ? 'instantSources' : 'allSources'}
              label={
                hideUncachedStreams
                  ? t({
                      message: 'Show all sources',
                      comment:
                        'App bar toggle that also shows uploads that must be downloaded first',
                    })
                  : t({
                      message: 'Only sources that play right away',
                      comment: 'App bar toggle that hides uploads that must be downloaded first',
                    })
              }
              onPress={() => setHideUncachedStreams((hidden) => !hidden)}
            />
          ) : null}
        </>
      }
    >
      {settled && !listings.error && groups.length === 0 ? (
        <Empty
          glyph='search'
          height='fill'
          title={t({
            message: 'No sources found',
            comment: 'No uploads were found for a book',
          })}
          message={t({
            message: 'Try searching for the book by its title in Browse.',
            comment: 'Hint when nothing was found for a book; Browse is the tab for finding books',
          })}
          actionLabel={t({
            message: 'Open Browse',
            comment: 'Opens the Browse tab from an empty list of sources',
          })}
          onAction={() => router.navigate('/browse')}
        />
      ) : (
        <List
          grouped
          bottomPadding={32}
          loading={!settled && groups.length === 0 && !listings.error}
        >
          {listings.error ? (
            <Notice
              glyph='warning'
              tone='error'
              message={t({
                message: 'Sources could not be searched. Try again in a moment.',
                comment: 'Looking up uploads of a book failed',
              })}
              actionLabel={t({ message: 'Retry', comment: 'Retries a failed action' })}
              onAction={() => void listings.refetch()}
            />
          ) : null}
          {recordings.failed > 0 && settled ? (
            <Notice
              glyph='warning'
              message={t({
                message: 'Some streams could not be opened.',
                comment: 'Some uploads failed to load; a Retry button follows',
              })}
              actionLabel={t({ message: 'Retry', comment: 'Retries a failed action' })}
              onAction={recordings.retryFailed}
            />
          ) : null}
          {shown.map((group) => {
            const narrators = labels.fewNames(group.narrators, 3)

            return (
              <Group
                key={group.key}
                title={
                  narrators
                    ? t({
                        message: `Read by ${narrators}`,
                        comment: 'Heading over the uploads of one narrator’s recording',
                      })
                    : t({
                        message: 'Narrator not named',
                        comment: 'Heading over uploads that do not credit a narrator',
                      })
                }
                caption={caption(group)}
                rows={rowsOf(group)}
              />
            )
          })}
          {!settled && groups.length > 0 ? <Loading /> : null}
        </List>
      )}
      {cancelPrompt.dialog}
      {availability.dialog}
      {info ? (
        <SourceInfoSheet
          post={info.post}
          title={info.title}
          cached={cached === null ? null : cached.has(info.post.infoHash.toLowerCase())}
          onDismiss={() => setInfo(null)}
        />
      ) : null}
    </Screen>
  )
}
