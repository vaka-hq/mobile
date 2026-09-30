import { useLingui } from '@lingui/react/macro'
import { useRef } from 'react'
import { fillMaxWidth, padding, verticalScroll } from '@/lib/compose-modifiers'
import { Column, Text } from '@/lib/compose-ui'
import type { EbookMark, HighlightColor } from '@/library/ebooks'
import {
  readerDefaults,
  resetReaderPreferences,
  setPreference,
  usePreferences,
} from '@/settings/preferences'
import {
  CardItem,
  Crossfade,
  Empty,
  FadeStates,
  Group,
  List,
  LoadingPage,
  SearchField,
  type SearchFieldHandle,
} from '@/ui/primitives'
import {
  HighlightColors,
  ReaderChoices,
  type ReaderPalette,
  ReaderPanel,
  ReaderSearchPage,
  ReaderSetting,
  ReaderTextSize,
  shownTheme,
} from '@/ui/reader'
import { Action } from '@/ui/screen'
import { Sheet, SheetList, useOpenSheetBody } from '@/ui/sheets'
import type { TocItem } from './reader-view'

/** The book's table of contents, the chapter being read marked, opened with it in view. */
export function ContentsSheet({
  toc,
  currentHref,
  onSelect,
  onDismiss,
}: {
  toc: TocItem[]
  currentHref: string | null
  onSelect: (href: string) => void
  onDismiss: () => void
}) {
  const { t } = useLingui()
  const current = toc.findIndex((item) => item.href === currentHref)

  return (
    <Sheet
      title={t({ message: 'Contents', comment: 'Title of the reader’s table of contents' })}
      onDismiss={onDismiss}
    >
      {(close) =>
        toc.length === 0 ? (
          <Empty
            glyph='chapters'
            title={t({
              message: 'This book has no table of contents',
              comment: 'Reader contents sheet when the book lists no chapters',
            })}
            height={220}
          />
        ) : (
          <SheetList initialIndex={Math.max(0, current)}>
            {toc.map((item, index) => (
              <CardItem
                key={`${index}:${item.href}`}
                card={{ index, count: toc.length }}
                selected={index === current}
                indent={Math.min(item.depth, 3)}
                headline={item.label}
                onPress={() => {
                  onSelect(item.href)
                  close()
                }}
              />
            ))}
          </SheetList>
        )
      }
    </Sheet>
  )
}

/** A passage in the quotation marks of the reader's language. */
function useQuoted() {
  const { t } = useLingui()

  return (passage: string) =>
    t({ message: `“${passage}”`, comment: 'A highlighted passage in quotation marks' })
}

/**
 * The book's highlights, notes and bookmarks, in the order they were made; each opens where it
 * was made. The sheet keeps its opening height as marks come and go, and the list and its empty
 * state crossfade.
 */
export function NotesSheet({
  marks,
  onOpen,
  onDelete,
  onDismiss,
}: {
  marks: EbookMark[]
  onOpen: (mark: EbookMark) => void
  onDelete: (mark: EbookMark) => void
  onDismiss: () => void
}) {
  const { t } = useLingui()
  const quoted = useQuoted()
  const openBody = useOpenSheetBody()

  return (
    <Sheet
      title={t({
        message: 'Notes and bookmarks',
        comment: 'Title of the reader sheet listing highlights and bookmarks',
      })}
      onDismiss={onDismiss}
    >
      {(close) => (
        <Crossfade
          showSecond={marks.length === 0}
          first={
            <SheetList minHeight={openBody}>
              {marks.map((mark, index) => (
                <CardItem
                  key={mark.id}
                  card={{ index, count: marks.length }}
                  leading={{ glyph: mark.kind === 'bookmark' ? 'bookmarkFilled' : 'highlight' }}
                  headline={
                    mark.kind === 'bookmark'
                      ? (mark.text ??
                        t({ message: 'Bookmark', comment: 'A bookmark without a chapter name' }))
                      : quoted(mark.text ?? '')
                  }
                  supporting={mark.note}
                  action={
                    <Action
                      glyph='delete'
                      label={
                        mark.kind === 'bookmark'
                          ? t({ message: 'Delete bookmark', comment: 'Reader notes sheet button' })
                          : t({ message: 'Delete highlight', comment: 'Reader notes sheet button' })
                      }
                      onPress={() => onDelete(mark)}
                    />
                  }
                  onPress={() => {
                    onOpen(mark)
                    close()
                  }}
                />
              ))}
            </SheetList>
          }
          second={
            <Empty
              glyph='bookmarks'
              title={t({
                message: 'Nothing saved yet',
                comment: 'Reader notes sheet before anything was highlighted or bookmarked',
              })}
              message={t({
                message: 'Tap a page’s top corner to bookmark it, or select text to highlight it.',
                comment: 'How to add to the empty notes and bookmarks sheet',
              })}
              height={Math.max(160, openBody)}
            />
          }
        />
      )}
    </Sheet>
  )
}

const fontSizes = { min: 70, max: 200, step: 10 }

/**
 * How the book is set: whether the page is light or dark, the text's size and font, and its
 * spacing, margins and alignment, in a card over the foot of the page being read, so the page
 * around it shows every change.
 */
export function DisplayPanel({
  palette,
  systemDark,
  onClose,
}: {
  palette: ReaderPalette
  systemDark: boolean
  onClose: () => void
}) {
  const { t, i18n } = useLingui()
  const preferences = usePreferences()
  const fontSize = preferences.readerFontSize

  // A theme picked that matches the phone looks no different from following it.
  const changed =
    preferences.readerFontSize !== readerDefaults.readerFontSize ||
    preferences.readerLineHeight !== readerDefaults.readerLineHeight ||
    preferences.readerFont !== readerDefaults.readerFont ||
    preferences.readerMargin !== readerDefaults.readerMargin ||
    preferences.readerJustify !== readerDefaults.readerJustify ||
    shownTheme(preferences.readerTheme, systemDark) !==
      shownTheme(readerDefaults.readerTheme, systemDark)

  return (
    <ReaderPanel
      palette={palette}
      title={t({ message: 'Display', comment: 'Title of the reader’s display settings panel' })}
      closeLabel={t({ message: 'Close', comment: 'Closes the reader’s display settings panel' })}
      onClose={onClose}
      reset={{
        label: t({
          message: 'Reset to default',
          comment: 'Button in the reader’s display settings panel putting every setting back',
        }),
        visible: changed,
        onPress: () => void resetReaderPreferences(),
      }}
    >
      <ReaderSetting
        palette={palette}
        label={t({ message: 'Page', comment: 'Reader display setting: a light or dark page' })}
      >
        <ReaderChoices
          palette={palette}
          choices={[
            {
              key: 'light',
              label: t({ message: 'Light', context: 'page', comment: 'Reader page theme' }),
            },
            {
              key: 'dark',
              label: t({ message: 'Dark', context: 'page', comment: 'Reader page theme' }),
            },
          ]}
          // Until one is picked the page follows the phone, which the choice shows.
          selected={shownTheme(preferences.readerTheme, systemDark)}
          onSelect={(theme) => void setPreference('readerTheme', theme)}
        />
      </ReaderSetting>
      <ReaderSetting
        palette={palette}
        label={t({ message: 'Text size', comment: 'Reader display setting' })}
      >
        <ReaderTextSize
          palette={palette}
          value={i18n.number(fontSize / 100, { style: 'percent' })}
          labels={{
            smaller: t({ message: 'Smaller text', comment: 'Reader display setting' }),
            larger: t({ message: 'Larger text', comment: 'Reader display setting' }),
          }}
          canShrink={fontSize > fontSizes.min}
          canGrow={fontSize < fontSizes.max}
          onShrink={() => void setPreference('readerFontSize', fontSize - fontSizes.step)}
          onGrow={() => void setPreference('readerFontSize', fontSize + fontSizes.step)}
        />
      </ReaderSetting>
      <ReaderSetting
        palette={palette}
        label={t({ message: 'Font', comment: 'Reader display setting' })}
      >
        <ReaderChoices
          palette={palette}
          choices={[
            {
              key: 'publisher',
              label: t({
                message: 'Original',
                comment: 'Reader font choice: the font the book comes with',
              }),
            },
            { key: 'serif', label: t({ message: 'Serif', comment: 'Reader font choice' }) },
            {
              key: 'sans',
              label: t({ message: 'Sans', comment: 'Reader font choice: sans serif' }),
            },
          ]}
          selected={preferences.readerFont}
          onSelect={(font) => void setPreference('readerFont', font)}
        />
      </ReaderSetting>
      <ReaderSetting
        palette={palette}
        label={t({ message: 'Line spacing', comment: 'Reader display setting' })}
      >
        <ReaderChoices
          palette={palette}
          choices={[
            {
              key: 1.3,
              glyph: 'linesCompact',
              label: t({ message: 'Compact', comment: 'Reader line spacing choice' }),
            },
            {
              key: 1.5,
              glyph: 'linesNormal',
              label: t({ message: 'Normal', comment: 'Reader line spacing choice' }),
            },
            {
              key: 1.8,
              glyph: 'linesRelaxed',
              label: t({ message: 'Relaxed', comment: 'Reader line spacing choice' }),
            },
          ]}
          selected={preferences.readerLineHeight}
          onSelect={(value) => void setPreference('readerLineHeight', value)}
        />
      </ReaderSetting>
      <ReaderSetting
        palette={palette}
        label={t({ message: 'Margins', comment: 'Reader display setting' })}
      >
        <ReaderChoices
          palette={palette}
          choices={[
            {
              key: 12,
              glyph: 'marginsNarrow',
              label: t({ message: 'Narrow', comment: 'Reader margin choice' }),
            },
            {
              key: 24,
              glyph: 'marginsNormal',
              label: t({ message: 'Normal', context: 'margins', comment: 'Reader margin choice' }),
            },
            {
              key: 40,
              glyph: 'marginsWide',
              label: t({ message: 'Wide', comment: 'Reader margin choice' }),
            },
          ]}
          selected={preferences.readerMargin}
          onSelect={(value) => void setPreference('readerMargin', value)}
        />
      </ReaderSetting>
      <ReaderSetting
        palette={palette}
        label={t({ message: 'Alignment', comment: 'Reader display setting' })}
      >
        <ReaderChoices
          palette={palette}
          choices={[
            {
              key: 'justify',
              glyph: 'alignJustify',
              label: t({ message: 'Justified', comment: 'Reader text alignment choice' }),
            },
            {
              key: 'start',
              glyph: 'alignStart',
              label: t({ message: 'Left', comment: 'Reader text alignment choice' }),
            },
          ]}
          selected={preferences.readerJustify ? 'justify' : 'start'}
          onSelect={(value) => void setPreference('readerJustify', value === 'justify')}
        />
      </ReaderSetting>
    </ReaderPanel>
  )
}

export type SearchHit = {
  location: string
  label: string | null
  excerpt: string
  /** Where the match stands in the excerpt, to mark it. */
  match: { start: number; length: number } | null
}

/**
 * Searches the book's text on a page of its own: a search bar at the top, and each result a card
 * with a few lines around the match, the match marked, and its chapter; one opens there.
 */
export function BookSearchPage({
  palette,
  bottomInset,
  query,
  results,
  searching,
  onSearch,
  onSelect,
  onBack,
}: {
  palette: ReaderPalette
  bottomInset: number
  query: string
  results: SearchHit[]
  searching: boolean
  onSearch: (query: string) => void
  onSelect: (hit: SearchHit) => void
  onBack: () => void
}) {
  const { t } = useLingui()
  const field = useRef<SearchFieldHandle>(null)

  // The keyboard is put away before the page goes, or it would stay open over the book.
  function leave(then: () => void) {
    void (field.current?.blur() ?? Promise.resolve()).then(then)
  }

  return (
    <ReaderSearchPage
      palette={palette}
      onBack={() => leave(onBack)}
      searchBar={
        <SearchField
          ref={field}
          initialValue={query}
          // Ready to type at once, unless it opens on a search already made.
          autoFocus={!query}
          placeholder={t({
            message: 'Search in book',
            comment: 'Placeholder of the search bar on the reader’s search page',
          })}
          onChange={() => undefined}
          onSubmit={(value) => onSearch(value.trim())}
          onBack={onBack}
        />
      }
    >
      <FadeStates
        current={
          results.length > 0 ? 'found' : searching ? 'searching' : query ? 'notFound' : 'start'
        }
        states={{
          start: (
            <Empty
              glyph='search'
              title={t({
                message: 'Search this book',
                comment: 'Reader search page before anything was searched',
              })}
              message={t({
                message: 'Find a word or a phrase anywhere in the book.',
                comment: 'Reader search page before anything was searched',
              })}
              height='fill'
            />
          ),
          searching: <LoadingPage />,
          notFound: (
            <Empty
              glyph='search'
              title={t({
                message: 'Not found in this book',
                comment: 'Reader search without results',
              })}
              message={t({
                message: 'Try another word or a shorter phrase.',
                comment: 'Reader search without results, suggesting what to try',
              })}
              height='fill'
            />
          ),
          found: (
            <List cards bottomPadding={16 + bottomInset}>
              {results.map((hit, index) => (
                <CardItem
                  key={`${index}:${hit.location}`}
                  card={{ index, count: results.length }}
                  headline={hit.excerpt}
                  highlight={hit.match}
                  headlineLines={5}
                  supporting={hit.label}
                  onPress={() => leave(() => onSelect(hit))}
                />
              ))}
            </List>
          ),
        }}
      />
    </ReaderSearchPage>
  )
}

/** One highlight: its passage and note, its colour, and sharing or deleting it. */
export function HighlightSheet({
  mark,
  onColor,
  onEditNote,
  onRemoveNote,
  onShare,
  onDelete,
  onDismiss,
}: {
  mark: EbookMark
  onColor: (color: HighlightColor) => void
  onEditNote: () => void
  onRemoveNote: () => void
  onShare: () => void
  onDelete: () => void
  onDismiss: () => void
}) {
  const { t } = useLingui()
  const quoted = useQuoted()

  return (
    <Sheet
      title={t({ message: 'Highlight', comment: 'Title of the sheet for one highlight' })}
      onDismiss={onDismiss}
    >
      {(close) => (
        <Column
          modifiers={[fillMaxWidth(), verticalScroll(), padding(16, 0, 16, 24)]}
          verticalArrangement={{ spacedBy: 16 }}
        >
          <Text
            maxLines={8}
            overflow='ellipsis'
            style={{ typography: 'bodyLarge', fontStyle: 'italic' }}
            modifiers={[padding(8, 0, 8, 0)]}
          >
            {quoted(mark.text ?? '')}
          </Text>
          <HighlightColors selected={mark.color} onSelect={onColor} />
          <Group
            rows={[
              {
                key: 'note',
                glyph: 'note',
                label: mark.note
                  ? t({ message: 'Edit note', comment: 'Highlight sheet row' })
                  : t({ message: 'Add a note', comment: 'Highlight sheet row' }),
                value: mark.note ?? undefined,
                onPress: onEditNote,
              },
              ...(mark.note
                ? [
                    {
                      key: 'removeNote',
                      glyph: 'clear' as const,
                      label: t({ message: 'Remove note', comment: 'Highlight sheet row' }),
                      onPress: onRemoveNote,
                    },
                  ]
                : []),
              {
                key: 'share',
                glyph: 'share',
                label: t({ message: 'Share', comment: 'Highlight sheet row sharing the passage' }),
                onPress: onShare,
              },
              {
                key: 'delete',
                glyph: 'delete',
                label: t({ message: 'Delete highlight', comment: 'Highlight sheet row' }),
                onPress: () => {
                  onDelete()
                  close()
                },
              },
            ]}
          />
        </Column>
      )}
    </Sheet>
  )
}
