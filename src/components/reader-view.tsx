import { forwardRef, useImperativeHandle, useRef } from 'react'
import { z } from 'zod'
import { Host } from '@/components/host'
import { BookView, type BookViewRef } from '../../modules/android-components'

/** How the reader sets the book, from its settings and theme. */
export type ReaderStyle = {
  fontSize: number
  lineHeight: number
  fontFamily: 'publisher' | 'serif' | 'sans'
  justify: boolean
  /** Space above the text on each page, and below it, in dp. */
  margin: number
  marginBottom: number
  gap: number
  background: string
  foreground: string
  link: string
}

/** A highlight to draw: its place, its colour, and its text, to find it again if its place is gone. */
export type ReaderAnnotation = { value: string; color: string; text?: string }

/** A command for the reader. */
export type ReaderCommand =
  | {
      type: 'open'
      uri: string
      location: string | null
      /** How far through the book, to open at when the saved place is not the reader's own. */
      fraction: number
      /** Marks the sentence the book opens at, as when it picks up where listening stopped. */
      mark: boolean
      style: ReaderStyle
      annotations: ReaderAnnotation[]
      bookmarks: string[]
    }
  | { type: 'bookmarks'; locations: string[] }
  | {
      type: 'overview'
      on: boolean
      /** Where the page card sits in the overview, in dp. */
      scale?: number
      shift?: number
      gap?: number
      radius?: number
    }
  | { type: 'style'; style: ReaderStyle }
  /** How much of the page the app covers from below, in dp, to centre what it shows above. */
  | { type: 'coveredBelow'; height: number }
  | { type: 'goTo'; target: string }
  /** A share of the way into the book, from 0 to 1, as the place a listener reached estimates. */
  | { type: 'goToFraction'; fraction: number }
  /**
   * Heard words to find in the text around `fraction`; the book moves to the last of them, or the
   * first with `anchor: 'start'`, and reports `passage`.
   */
  | { type: 'findPassage'; words: string[]; fraction: number; anchor: 'start' | 'end' }
  /**
   * The overview's slider: while dragged the row of pages follows it, and with `settle` the book
   * moves to where it was let go.
   */
  | { type: 'scrub'; fraction: number; settle: boolean }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'search'; query: string }
  | { type: 'clearSearch' }
  | { type: 'addAnnotation'; annotation: ReaderAnnotation }
  | { type: 'removeAnnotation'; value: string }
  | { type: 'clearSelection' }
  /**
   * What the page's actions are called, in the listener's language: those TalkBack offers, and
   * those of the toolbar over selected text.
   */
  | {
      type: 'labels'
      showControls: string
      nextPage: string
      previousPage: string
      highlight: string
      note: string
      copy: string
      share: string
    }

const tocItem = z.object({
  label: z.string(),
  href: z.string(),
  depth: z.number(),
  /** Where the entry starts in the book, from 0 to 1, when the reader found it. */
  fraction: z.number().nullable().catch(null),
})

export type TocItem = z.infer<typeof tocItem>

/** What the reader reports, checked here since it crosses from native code. */
const readerEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('opened'),
    title: z.string().nullable(),
    author: z.string().nullable(),
    toc: z.array(tocItem),
    sectionFractions: z.array(z.number()),
  }),
  z.object({
    type: z.literal('relocate'),
    location: z.string(),
    /** Where the page showing starts, the place a bookmark added now points to. */
    pageStart: z.string(),
    /** The bookmark on the page showing, if any. */
    bookmark: z.string().nullable(),
    /** Pages left in the part being read, when the book turns pages. */
    sectionPagesLeft: z.number().nullable(),
    fraction: z.number(),
    tocLabel: z.string().nullable(),
    tocHref: z.string().nullable(),
    sectionMinutesLeft: z.number().nullable(),
    bookMinutesLeft: z.number().nullable(),
    page: z.number().nullable(),
    pages: z.number().nullable(),
    /** The words at the top of the page, to find the place in the audiobook. */
    passage: z.string().nullable().catch(null),
  }),
  z.object({ type: z.literal('tap') }),
  /** A finger was drawn down the page, asking for the top bar over it. */
  z.object({ type: z.literal('pullDown') }),
  /** A finger was drawn up on the page, putting that bar away. */
  z.object({ type: z.literal('pullUp') }),
  /**
   * The page's top corner was tapped: its bookmark is added at `add`, where the page starts, or the
   * ones at `remove` are taken away. The reader has already moved its ribbon.
   */
  z.object({
    type: z.literal('bookmark'),
    add: z.string().nullable(),
    remove: z.array(z.string()),
  }),
  /**
   * A pinch is moving the page into the overview: how far, from 0 to 1, and once the fingers lift,
   * whether it carries on into the overview or settles back.
   */
  z.object({
    type: z.literal('pinchProgress'),
    value: z.number(),
    ended: z.boolean(),
    open: z.boolean(),
  }),
  z.object({
    type: z.literal('selection'),
    text: z.string().nullable(),
    location: z.string().nullable(),
  }),
  z.object({ type: z.literal('showAnnotation'), value: z.string() }),
  /** Highlight or Note was chosen in the toolbar over the selection. */
  z.object({ type: z.literal('selectionAction'), action: z.enum(['highlight', 'note']) }),
  z.object({
    type: z.literal('searchResult'),
    location: z.string(),
    label: z.string().nullable(),
    excerpt: z.string().nullable(),
    /** Where the match stands in the excerpt, in characters. */
    matchStart: z.number().int().nonnegative().nullable().catch(null),
    matchLength: z.number().int().nonnegative().nullable().catch(null),
  }),
  z.object({ type: z.literal('searchDone'), count: z.number() }),
  /** Whether heard words were found near where they were looked for, and the book moved there. */
  z.object({ type: z.literal('passage'), found: z.boolean() }),
  z.object({ type: z.literal('error'), message: z.string() }),
])

export type ReaderEvent = z.infer<typeof readerEvent>

/** Reads one message from the reader; anything that is not a known event is dropped. */
export function parseReaderEvent(data: string): ReaderEvent | null {
  try {
    const parsed = readerEvent.safeParse(JSON.parse(data))

    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export type ReaderViewHandle = { send: (command: ReaderCommand) => void }

/**
 * The book itself, drawn natively in Compose: EPUB chapters laid out into pages or one scrolling
 * column. Commands go in through `send`; everything the reader sees comes out through `onEvent`.
 */
export const ReaderView = forwardRef<ReaderViewHandle, { onEvent: (event: ReaderEvent) => void }>(
  function ReaderView({ onEvent }, ref) {
    const book = useRef<BookViewRef>(null)

    useImperativeHandle(ref, () => ({
      // A command to a view already replaced is dropped; the new one reports ready and is sent
      // the book again.
      send: (command) => {
        void book.current?.send(JSON.stringify(command)).catch(() => undefined)
      },
    }))

    return (
      <Host style={{ flex: 1 }}>
        <BookView
          ref={book}
          style={{ flex: 1 }}
          onMessage={(data) => {
            const event = parseReaderEvent(data)

            if (event) {
              onEvent(event)
            }
          }}
        />
      </Host>
    )
  },
)
