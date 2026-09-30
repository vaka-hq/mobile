import { plural } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { chapterNumber, hoursAndMinutes } from './format'

/** Localized labels shared by several screens. */
export function useLabels() {
  const { t, i18n } = useLingui()

  function duration(seconds: number) {
    const { hours, minutes } = hoursAndMinutes(seconds)

    return hours > 0
      ? t({ message: `${hours} h ${minutes} min`, comment: 'A duration in hours and minutes' })
      : t({ message: `${minutes} min`, comment: 'A duration in minutes' })
  }

  return {
    duration,
    remaining: (seconds: number) =>
      t({
        message: `${duration(seconds)} left`,
        comment: 'Listening time remaining, for example “3 h 20 min left”',
      }),
    // Untitled chapters and ones titled only by a number, such as "001", read "Chapter 1".
    chapter: (title: string | null | undefined, index: number) => {
      const number = title ? chapterNumber(title) : index + 1

      return number === null
        ? (title ?? '')
        : t({
            message: `Chapter ${number}`,
            comment: 'Name of a chapter without a title of its own, like “Chapter 3”',
          })
    },
    authors: (names: string[]) => names.join(', '),
    /** Where reading stopped: its page of all of them, or how far in when pages are not counted. */
    readingPlace: (place: { page: number | null; pages: number | null; progress: number }) => {
      const { page, pages } = place

      return page && pages
        ? t({
            message: `Page ${page} of ${pages}`,
            comment: 'Where reading stopped in an e-book, for example “Page 243 of 617”',
          })
        : i18n.number(place.progress, { style: 'percent' })
    },
    /** What is left to read: the pages after the one reading stopped on, or how far in it is. */
    readingLeft: (place: { page: number | null; pages: number | null; progress: number }) => {
      const { page, pages } = place

      if (page && pages) {
        const left = Math.max(0, pages - page)

        return left === 0
          ? t({ message: 'Last page', comment: 'Reading stopped on the e-book’s last page' })
          : t({
              message: plural(left, { one: '# page left', other: '# pages left' }),
              comment: 'Pages left to read in an e-book, for example “243 pages left”',
            })
      }

      return t({
        message: `${i18n.number(place.progress, { style: 'percent' })} read`,
        comment: 'How far into an e-book reading has got, when its pages are not counted',
      })
    },
    /** Where listening stopped, and how long the book is when that is known. */
    listeningPlace: (seconds: number, total: number | null) => {
      const heard = duration(seconds)
      const length = total ? duration(total) : null

      return length
        ? t({
            message: `${heard} of ${length}`,
            comment:
              'Where listening stopped in an audiobook, for example “1 h 5 min of 16 h 7 min”',
          })
        : heard
    },
    /**
     * The first names of a long list and how many more there are, such as a recording read by a
     * whole cast: “Stephen Fry, Jim Dale and 10 more”.
     */
    fewNames: (names: string[], shown = 2) => {
      if (names.length <= shown + 1) {
        return names.join(', ')
      }

      const first = names.slice(0, shown).join(', ')
      const more = names.length - shown

      return t({
        message: plural(more, { one: `${first} and # more`, other: `${first} and # more` }),
        comment: 'The first names of a long list of narrators, then how many more there are',
      })
    },
  }
}
