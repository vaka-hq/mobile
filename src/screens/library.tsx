import { useLingui } from '@lingui/react/macro'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useOpenEbook } from '@/components/ebook-row'
import { useRemovalQuestion } from '@/components/library-toggle'
import { DropdownMenu, DropdownMenuItem, Text } from '@/lib/compose-ui'
import { useFeedback } from '@/lib/feedback'
import { displayDuration, displayEntry } from '@/library/display'
import {
  type Ebook,
  ebookResultOf,
  removeEbook,
  removeEbookFile,
  useEbooks,
} from '@/library/ebooks'
import { type LibraryEntry, workPath } from '@/library/model'
import { useOfflineBooks } from '@/library/offline'
import {
  useFollowedSeries,
  useLibrary,
  useMarkWork,
  useSetWorkInLibrary,
  useSyncFollowedSeries,
} from '@/library/queries'
import { open, togglePlay } from '@/player/controller'
import { listeningProgress, summarize } from '@/player/summary'
import { usePlayerValue } from '@/player/use-player'
import { readNames, setPreference, usePreferences } from '@/settings/preferences'
import { ConfirmDialog } from '@/ui/dialogs'
import { useErrorText } from '@/ui/errors'
import { useLabels } from '@/ui/labels'
import {
  BookRow,
  CardItem,
  Empty,
  FilterBar,
  List,
  Notice,
  PlayToggle,
  SearchField,
  ReadButton,
} from '@/ui/primitives'
import { FilledAction, Screen } from '@/ui/screen'
import { FilterSheet } from '@/ui/sheets'

/** A question asked before a menu action that cannot be undone. */
type Confirmation = { title: string; message: string; confirmLabel: string; run: () => void }

/**
 * Where a book in the library stands: being listened to or read, whichever was done last, not
 * started, or finished.
 */
type State = 'listening' | 'reading' | 'notStarted' | 'finished'

/** The shelves the screen is made of: books in progress, either way, then not started, finished. */
type Shelf = 'inProgress' | 'notStarted' | 'finished'

function shelfOf(state: State): Shelf {
  return state === 'listening' || state === 'reading' ? 'inProgress' : state
}

/** How far an e-book counts as read to its end, since its last page starts short of it. */
const readToEnd = 0.98

/** Where a row stands in the run of cards, for its corners. */
type Layout = { index: number; count: number }

/** A book in the library as the screen shows it: an audiobook's work, or an e-book on its own. */
type Item = {
  key: string
  state: State
  /** When it was last listened to or read, else added. */
  active: number
  added: number
  title: string
  authors: string[]
  series: string | null
} & ({ kind: 'work'; entry: LibraryEntry; ebook: Ebook | null } | { kind: 'ebook'; ebook: Ebook })

/**
 * Where a work stands: finished if listened to the end or marked so; else read or listened to,
 * whichever was done last; else not started. The book open in the player counts as listened to
 * from its first second, before any progress is saved.
 */
function workItem(
  entry: LibraryEntry,
  ebooks: Ebook[],
  playingId: string | null,
): Extract<Item, { kind: 'work' }> {
  const shown = displayEntry(entry)
  const read = ebooks.filter((ebook) => ebook.workId === entry.work.id)
  const readAt = Math.max(0, ...read.map((ebook) => ebook.lastReadAt ?? 0))
  const playing = playingId !== null && entry.book?.id === playingId

  const heardAt = playing
    ? Date.now()
    : entry.playback
      ? (entry.work.lastPlayedAt ?? entry.playback.updatedAt)
      : (entry.work.lastPlayedAt ?? 0)

  const state: State =
    entry.playback?.finished || entry.work.finishedAt !== null
      ? 'finished'
      : readAt > heardAt
        ? 'reading'
        : heardAt > 0 || entry.playback !== null
          ? 'listening'
          : 'notStarted'

  // The e-book the book is read in: the one read last, else the one chosen last.
  const ebook =
    [...read].sort(
      (a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || (b.chosenAt ?? 0) - (a.chosenAt ?? 0),
    )[0] ?? null

  return {
    kind: 'work',
    key: entry.work.id,
    entry,
    ebook,
    state,
    active: Math.max(heardAt, readAt, entry.work.addedAt ?? 0),
    added: entry.work.addedAt ?? 0,
    title: shown.title,
    authors: shown.authors,
    series: seriesOf(entry)?.name ?? null,
  }
}

/** An e-book read, kept or downloading that belongs to no book, such as one found in Search. */
function ebookItem(ebook: Ebook): Extract<Item, { kind: 'ebook' }> {
  const state: State =
    ebook.progress >= readToEnd ? 'finished' : ebook.lastReadAt !== null ? 'reading' : 'notStarted'

  return {
    kind: 'ebook',
    key: `ebook:${ebook.md5}`,
    ebook,
    state,
    active: ebook.lastReadAt ?? ebook.addedAt,
    added: ebook.addedAt,
    title: ebook.title,
    authors: ebook.authors,
    series: null,
  }
}

/**
 * One book in the library. It opens the book; holding it offers marking it
 * and removing it. A book in progress also carries on from here: one listened to last plays or
 * pauses, and one read last opens to read. The one in the player is highlighted.
 */
function LibraryRow({
  item,
  layout,
  confirm,
}: {
  item: Extract<Item, { kind: 'work' }>
  layout: Layout
  confirm: (confirmation: Confirmation) => void
}) {
  const { entry, ebook, state } = item
  const openEbook = useOpenEbook()
  const { t } = useLingui()
  const errorText = useErrorText()
  const router = useRouter()
  const labels = useLabels()
  const { showFeedback } = useFeedback()
  const [menuOpen, setMenuOpen] = useState(false)
  const setInLibrary = useSetWorkInLibrary(entry.work.id, entry.work.work)
  const removal = useRemovalQuestion()
  const mark = useMarkWork(entry.work.id, entry.work.work)
  const failed = (error: Error) => showFeedback(errorText(error))
  const { book, playback } = entry

  // Only the row of the book open in the player follows it live; the rest ignore its ticks.
  const player = usePlayerValue((state) =>
    book !== null && state.book?.id === book.id ? state : null,
  )

  const shown = displayEntry(entry)
  const { title } = shown
  const current = player !== null
  const playing = player !== null && (player.playing || player.loading)
  const duration = book ? displayDuration(book) : null

  // The open book follows the player live; the others show their saved progress.
  const live =
    book && player ? summarize(book, player.track, player.position, player.duration) : null

  const progress = live
    ? live.bookTotal
      ? live.bookElapsed / live.bookTotal
      : null
    : book
      ? listeningProgress(book, playback)
      : null

  const left = live
    ? live.bookTotal !== null
      ? live.bookTotal - live.bookElapsed
      : null
    : progress !== null && duration !== null
      ? duration * (1 - progress)
      : null

  const offline = useOfflineBooks().get(book?.id ?? '')?.status === 'done'

  // What is left of it, the way it was followed last: the time to listen, or the pages to read.
  const timing =
    state === 'listening'
      ? left !== null
        ? labels.remaining(left)
        : null
      : state === 'reading' && ebook
        ? labels.readingLeft(ebook)
        : duration !== null
          ? labels.duration(duration)
          : null

  // Books kept on the phone say so, since they play without a connection; not while being read,
  // when what is shown is the e-book.
  const detail =
    [
      timing,
      offline && state !== 'reading'
        ? t({
            message: 'Downloaded',
            comment: 'Book row when the audiobook is downloaded for offline listening',
          })
        : null,
    ]
      .filter(Boolean)
      .join(' · ') || null

  async function playOrPause() {
    if (!book) {
      return
    }

    try {
      if (current) {
        togglePlay()
      } else {
        await open(book.id, true)
      }
    } catch (error) {
      showFeedback(errorText(error instanceof Error ? error : null))
    }
  }

  return (
    <DropdownMenu expanded={menuOpen} onDismissRequest={() => setMenuOpen(false)}>
      <DropdownMenu.Trigger>
        <BookRow
          card={layout}
          selected={current}
          title={title}
          subtitle={[labels.authors(shown.authors), shown.year].filter(Boolean).join(' · ') || null}
          detail={detail}
          coverUri={shown.cover.uri}
          coverColor={shown.cover.color}
          coverAspect={shown.cover.aspect}
          trailing={
            state === 'listening' && book ? (
              <PlayToggle
                playing={playing}
                selected={current}
                label={
                  playing
                    ? t({
                        message: `Pause ${title}`,
                        comment: 'Library row button pausing the book, with its title',
                      })
                    : t({
                        message: `Play ${title}`,
                        comment: 'Library row button resuming the book, with its title',
                      })
                }
                onPress={() => void playOrPause()}
              />
            ) : state === 'reading' && ebook ? (
              <ReadButton
                label={t({
                  message: `Read ${title}`,
                  comment: 'Library row button opening the book to read on, with its title',
                })}
                onPress={() => openEbook(ebookResultOf(ebook))}
              />
            ) : undefined
          }
          onPress={() => router.push(workPath(entry.work))}
          onLongPress={() => setMenuOpen(true)}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Items>
        {state !== 'finished' ? (
          <DropdownMenuItem
            onClick={() => {
              setMenuOpen(false)
              confirm({
                title: t({ message: 'Mark as finished?', comment: 'Dialog title' }),
                message: t({
                  message: 'You’ll lose your progress.',
                  comment:
                    'Warns that marking a book finished or not started resets where listening and reading stopped',
                }),
                confirmLabel: t({ message: 'Finish', comment: 'Confirms marking a book finished' }),
                run: () => mark.mutate('finished', { onError: failed }),
              })
            }}
          >
            <DropdownMenuItem.Text>
              <Text>
                {t({ message: 'Mark as finished', comment: 'Library and book menu action' })}
              </Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
        ) : null}
        {state !== 'notStarted' ? (
          <DropdownMenuItem
            onClick={() => {
              setMenuOpen(false)
              confirm({
                title: t({ message: 'Mark as not started?', comment: 'Dialog title' }),
                message: t({
                  message: 'You’ll lose your progress.',
                  comment:
                    'Warns that marking a book finished or not started resets where listening and reading stopped',
                }),
                confirmLabel: t({
                  message: 'Start over',
                  comment: 'Confirms marking a book not started',
                }),
                run: () => mark.mutate('notStarted', { onError: failed }),
              })
            }}
          >
            <DropdownMenuItem.Text>
              <Text>
                {t({
                  message: 'Mark as not started',
                  comment: 'Library and book menu action that forgets all progress',
                })}
              </Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={() => {
            setMenuOpen(false)
            confirm({ ...removal, run: () => setInLibrary.mutate(false, { onError: failed }) })
          }}
        >
          <DropdownMenuItem.Text>
            <Text>{t({ message: 'Remove from library', comment: 'Library menu action' })}</Text>
          </DropdownMenuItem.Text>
        </DropdownMenuItem>
      </DropdownMenu.Items>
    </DropdownMenu>
  )
}

/**
 * An e-book that belongs to no book, such as one found in Search: it opens where reading stopped,
 * and holding it offers to delete it. One still downloading shows how far it has got.
 */
function EbookLibraryRow({
  ebook,
  layout,
  confirm,
}: {
  ebook: Ebook
  layout: Layout
  confirm: (confirmation: Confirmation) => void
}) {
  const { t, i18n } = useLingui()
  const labels = useLabels()
  const openEbook = useOpenEbook()
  const [menuOpen, setMenuOpen] = useState(false)

  const detail =
    ebook.status === 'downloading'
      ? t({
          message: `Downloading · ${i18n.number(ebook.total > 0 ? ebook.bytes / ebook.total : 0, { style: 'percent' })}`,
          comment: 'E-book row while its file downloads, with how far it has got',
        })
      : ebook.lastReadAt !== null
        ? labels.readingLeft(ebook)
        : null

  return (
    <DropdownMenu expanded={menuOpen} onDismissRequest={() => setMenuOpen(false)}>
      <DropdownMenu.Trigger>
        <BookRow
          card={layout}
          title={ebook.title}
          subtitle={[labels.authors(ebook.authors), ebook.year].filter(Boolean).join(' · ') || null}
          detail={detail}
          coverUri={ebook.coverUrl}
          // A file not on the phone is fetched as it is opened, as listening streams.
          onPress={() => openEbook(ebookResultOf(ebook))}
          onLongPress={() => setMenuOpen(true)}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Items>
        <DropdownMenuItem
          onClick={() => {
            setMenuOpen(false)

            if (ebook.status === 'downloading') {
              // Stopping keeps the place and notes; only deleting the e-book forgets them.
              void removeEbookFile(ebook.md5)
            } else {
              confirm({
                title: t({ message: 'Delete e-book?', comment: 'Dialog title' }),
                message: t({
                  message: 'Its file, reading place, highlights and notes are deleted.',
                  comment: 'Explains deleting an e-book with everything kept for it',
                }),
                confirmLabel: t({ message: 'Delete', comment: 'Confirms deleting an e-book' }),
                run: () => void removeEbook(ebook.md5),
              })
            }
          }}
        >
          <DropdownMenuItem.Text>
            <Text>
              {ebook.status === 'downloading'
                ? t({ message: 'Cancel download', comment: 'Library e-book menu action' })
                : t({
                    message: 'Delete e-book with notes',
                    comment: 'Library e-book menu action deleting the file, place and highlights',
                  })}
            </Text>
          </DropdownMenuItem.Text>
        </DropdownMenuItem>
      </DropdownMenu.Items>
    </DropdownMenu>
  )
}

/** Where books stand, as the status filter chooses among them: in progress is either way. */
type Status = 'all' | 'inProgress' | State

/** How books are ordered, within each shelf when all are shown. */
type Sort = 'recent' | 'added' | 'title' | 'author'

type Picker = 'sort' | 'status' | 'authors' | 'series'

const statuses: Status[] = ['all', 'inProgress', 'listening', 'reading', 'notStarted', 'finished']

const sorts: Sort[] = ['recent', 'added', 'title', 'author']

/** The series a book in the library belongs to, as Hardcover lists it. */
function seriesOf(entry: LibraryEntry) {
  return entry.work.work?.series[0] ?? entry.book?.hardcover?.series[0] ?? null
}

/** Every distinct value, alphabetically. */
function distinct(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

/**
 * The listener's books, audiobooks and e-books together. As in the reference app, a sort and view
 * chip and filter chips sit under the app bar and slide away with it as the list scrolls; each
 * opens its choices in a sheet: the status is one choice, which closes the sheet, and authors and
 * series any number. Books are one run of cards; listed by when they were last played, those in
 * progress, listened to or read, come first, then those not started and the finished ones.
 */
export function LibraryScreen() {
  const { t } = useLingui()
  const router = useRouter()
  const library = useLibrary()
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const followedSeries = useFollowedSeries().data ?? []
  const playingId = usePlayerValue((state) => state.book?.id ?? null)
  const entries = library.data ?? []
  const ebookList = [...useEbooks().values()]

  // Books in the library, and e-books that belong to none, such as ones found in Search, once
  // read, kept or on their way.
  const items: Item[] = [
    ...entries.map((entry) => workItem(entry, ebookList, playingId)),
    ...ebookList.flatMap((ebook) =>
      ebook.workId === null &&
      (ebook.lastReadAt !== null || ebook.kept || ebook.status === 'downloading')
        ? [ebookItem(ebook)]
        : [],
    ),
  ]

  // The order and filters are kept, so the library opens as it was left, even after a restart.
  const preferences = usePreferences()
  const status = preferences.libraryStatus
  const sort = preferences.librarySort
  const authors = readNames(preferences.libraryAuthors)
  const series = readNames(preferences.librarySeries)
  const setStatus = (next: Status) => void setPreference('libraryStatus', next)
  const setSort = (next: Sort) => void setPreference('librarySort', next)
  const setAuthors = (next: string[]) => void setPreference('libraryAuthors', JSON.stringify(next))
  const setSeries = (next: string[]) => void setPreference('librarySeries', JSON.stringify(next))
  const [picker, setPicker] = useState<Picker | null>(null)
  // What the search field narrows the books to, by title.
  const [query, setQuery] = useState('')

  // Followed series gain their new books while the library is open.
  useSyncFollowedSeries()

  const shelfTitles: Record<Shelf, string> = {
    inProgress: t({
      message: 'In progress',
      comment: 'Library section and status of books being listened to or read',
    }),
    notStarted: t({ message: 'Not started', comment: 'Library section of books not yet played' }),
    finished: t({ message: 'Finished', comment: 'Library section of books listened to the end' }),
  }

  const statusLabels: Record<Status, string> = {
    all: t({ message: 'All', comment: 'Library status filter: every book' }),
    inProgress: shelfTitles.inProgress,
    listening: t({
      message: 'Listening',
      comment: 'Library status filter: books being listened to',
    }),
    reading: t({ message: 'Reading', comment: 'Library status filter: books being read' }),
    notStarted: shelfTitles.notStarted,
    finished: shelfTitles.finished,
  }

  const sortLabels: Record<Sort, string> = {
    recent: t({ message: 'Recently played', comment: 'Library sort order' }),
    added: t({ message: 'Recently added', comment: 'Library sort order' }),
    title: t({ message: 'Title', comment: 'Library sort order' }),
    author: t({ message: 'Author', comment: 'Library sort order' }),
  }

  const sortLabel = sortLabels[sort]
  const allAuthors = distinct(items.flatMap((item) => item.authors))
  const allSeries = distinct(items.flatMap((item) => item.series ?? []))

  const needle = query.trim().toLocaleLowerCase()

  // The search finds a book by its title, an author or its series.
  const found = (item: Item) =>
    [item.title, ...item.authors, item.series ?? ''].some((text) =>
      text.toLocaleLowerCase().includes(needle),
    )

  const matches = items.filter(
    (item) =>
      (needle === '' || found(item)) &&
      (authors.length === 0 || item.authors.some((author) => authors.includes(author))) &&
      (series.length === 0 || series.includes(item.series ?? '')),
  )

  const shown = matches.filter((item) =>
    status === 'all'
      ? true
      : status === 'inProgress'
        ? shelfOf(item.state) === 'inProgress'
        : item.state === status,
  )

  const author = (item: Item) => item.authors[0] ?? ''

  // One run of books with no headings. Recently played keeps the shelves' order, books in progress
  // first, most recently listened to or read, then books not started, newest first, then finished
  // ones; any other order runs across them all.
  const books = (() => {
    switch (sort) {
      case 'recent':
        return (['inProgress', 'notStarted', 'finished'] as const).flatMap((shelf) =>
          shown
            .filter((item) => shelfOf(item.state) === shelf)
            .sort((a, b) => (shelf === 'notStarted' ? b.added - a.added : b.active - a.active)),
        )
      case 'added':
        return [...shown].sort((a, b) => b.added - a.added)
      case 'title':
        return [...shown].sort((a, b) => a.title.localeCompare(b.title))
      case 'author':
        return [...shown].sort(
          (a, b) => author(a).localeCompare(author(b)) || a.title.localeCompare(b.title),
        )
    }
  })()

  /** A chip's label: its name, the one choice, or the name with how many are chosen. */
  function chosenLabel(name: string, chosen: string[]) {
    return chosen.length === 1
      ? (chosen[0] ?? name)
      : chosen.length > 1
        ? t({
            message: `${name} (${chosen.length})`,
            comment:
              'Library filter chip with several choices: the filter’s name and how many are chosen, like “Authors (3)”',
          })
        : name
  }

  function toggle(list: string[], value: string) {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
  }

  const authorsName = t({ message: 'Authors', comment: 'Library filter: by author' })
  const seriesName = t({ message: 'Series', comment: 'Library filter: by series' })

  const noMatches = !library.isPending && !library.error && items.length > 0 && books.length === 0

  const filterBar =
    items.length > 0 ? (
      <FilterBar
        sort={{
          label: t({
            message: `Sort: ${sortLabel}`,
            comment: 'Spoken label of the library sort chip, with the chosen order',
          }),
          // The order is how the library is shown, not a filter on what it holds.
          selected: false,
          onPress: () => setPicker('sort'),
        }}
        filters={[
          {
            label: statusLabels[status],
            selected: status !== 'all',
            onPress: () => setPicker('status'),
          },
          {
            label: chosenLabel(authorsName, authors),
            selected: authors.length > 0,
            onPress: () => setPicker('authors'),
          },
          {
            label: chosenLabel(seriesName, series),
            selected: series.length > 0,
            onPress: () => setPicker('series'),
          },
        ]}
      />
    ) : null

  function entryOf(item: Item, index: number, count: number) {
    return item.kind === 'work' ? (
      <LibraryRow key={item.key} item={item} layout={{ index, count }} confirm={setConfirmation} />
    ) : (
      <EbookLibraryRow
        key={item.key}
        ebook={item.ebook}
        layout={{ index, count }}
        confirm={setConfirmation}
      />
    )
  }

  return (
    <Screen
      title={t({ message: 'Library', comment: 'Title of the library screen' })}
      appBar='none'
      aboveNavigationBar
      // The search field takes the title's place, with the way to Settings beside it, and the
      // chips below; all of it slides away as the books scroll.
      header={
        <>
          <SearchField
            initialValue=''
            placeholder={t({
              message: 'Search your library',
              comment: 'Placeholder of the search field at the top of the library',
            })}
            onChange={setQuery}
            beforeChips
            trailing={
              <FilledAction
                glyph='settings'
                label={t({ message: 'Settings', comment: 'Opens the settings screen' })}
                onPress={() => router.push('/settings')}
              />
            }
          />
          {filterBar}
        </>
      }
    >
      {!library.isPending && !library.error && items.length === 0 ? (
        <Empty
          glyph='library'
          height='fill'
          title={t({ message: 'Your library is empty', comment: 'Empty library title' })}
        />
      ) : noMatches ? (
        <Empty
          glyph={needle ? 'search' : 'library'}
          height='fill'
          title={
            needle
              ? t({
                  message: 'No books match\nyour search',
                  comment:
                    'Searching the library finds no books; the line break splits the title in two',
                })
              : t({
                  message: 'No books match\nthese filters',
                  comment:
                    'The chosen library filters leave no books; the line break splits the title in two',
                })
          }
        />
      ) : (
        <List loading={library.isPending} underHeader>
          {library.error ? (
            <Notice
              glyph='warning'
              tone='error'
              message={t({
                message: 'Your library could not be read.',
                comment: 'Library load failure',
              })}
              actionLabel={t({ message: 'Retry', comment: 'Retries a failed action' })}
              onAction={() => void library.refetch()}
            />
          ) : null}
          {books.map((item, index) => entryOf(item, index, books.length))}
        </List>
      )}
      {picker === 'sort' ? (
        <FilterSheet
          title={t({ message: 'Sort by', comment: 'Title of the library sort sheet' })}
          onDismiss={() => setPicker(null)}
        >
          {(close) =>
            sorts.map((key, index, keys) => (
              <CardItem
                key={key}
                card={{ index, count: keys.length }}
                headline={sortLabels[key]}
                checked={sort === key}
                onPress={() => {
                  // One order at a time, so choosing it is all there is to do here.
                  setSort(key)
                  close()
                }}
              />
            ))
          }
        </FilterSheet>
      ) : null}
      {picker === 'status' ? (
        <FilterSheet
          title={t({ message: 'Status', comment: 'Library filter: where books stand' })}
          onDismiss={() => setPicker(null)}
        >
          {(close) =>
            statuses.map((key, index, keys) => (
              <CardItem
                key={key}
                card={{ index, count: keys.length }}
                headline={statusLabels[key]}
                checked={status === key}
                onPress={() => {
                  // One status at a time, so choosing it is all there is to do here.
                  setStatus(key)
                  close()
                }}
              />
            ))
          }
        </FilterSheet>
      ) : null}
      {picker === 'authors' ? (
        <FilterSheet
          title={authorsName}
          clear={{
            label: t({ message: 'Clear authors', comment: 'Resets the library author filter' }),
            enabled: authors.length > 0,
            onPress: () => setAuthors([]),
          }}
          empty={
            allAuthors.length === 0
              ? {
                  glyph: 'account',
                  title: t({
                    message: 'No authors yet',
                    comment: 'Author filter sheet when the library has no books with authors',
                  }),
                }
              : null
          }
          onDismiss={() => setPicker(null)}
        >
          {() =>
            allAuthors.map((author, index) => (
              <CardItem
                key={author}
                card={{ index, count: allAuthors.length }}
                headline={author}
                checked={authors.includes(author)}
                onPress={() => setAuthors(toggle(authors, author))}
              />
            ))
          }
        </FilterSheet>
      ) : null}
      {picker === 'series' ? (
        <FilterSheet
          title={seriesName}
          clear={{
            label: t({ message: 'Clear series', comment: 'Resets the library series filter' }),
            enabled: series.length > 0,
            onPress: () => setSeries([]),
          }}
          empty={
            allSeries.length === 0
              ? {
                  glyph: 'series',
                  title: t({
                    message: 'No series yet',
                    comment: 'Series filter sheet when no book in the library is part of a series',
                  }),
                  message: t({
                    message: 'Books in a series appear here once they are in your library.',
                    comment: 'Series filter sheet when no book in the library is part of a series',
                  }),
                }
              : null
          }
          onDismiss={() => setPicker(null)}
        >
          {() =>
            allSeries.map((name, index) => {
              const whole = entries.some((entry) => {
                const found = seriesOf(entry)

                return found?.name === name && followedSeries.some((item) => item.id === found.id)
              })

              return (
                <CardItem
                  key={name}
                  card={{ index, count: allSeries.length }}
                  headline={name}
                  supporting={
                    whole
                      ? t({
                          message: 'Whole series in library',
                          comment: 'Series row when every book of the series is in the library',
                        })
                      : null
                  }
                  checked={series.includes(name)}
                  onPress={() => setSeries(toggle(series, name))}
                />
              )
            })
          }
        </FilterSheet>
      ) : null}
      {confirmation ? (
        <ConfirmDialog
          title={confirmation.title}
          message={confirmation.message}
          confirmLabel={confirmation.confirmLabel}
          onConfirm={confirmation.run}
          onDismiss={() => setConfirmation(null)}
        />
      ) : null}
    </Screen>
  )
}
