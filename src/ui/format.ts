function pad(value: number) {
  return String(value).padStart(2, '0')
}

/** A media clock: `4:05`, or `1:04:05` past an hour. */
export function clock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

/** Whole hours and minutes for duration labels, rounding up so a remaining 20 s is `0 h 1 min`. */
export function hoursAndMinutes(totalSeconds: number) {
  const minutes = Math.max(0, Math.ceil(totalSeconds / 60))

  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 }
}

const dataUnits = ['B', 'kB', 'MB', 'GB'] as const

/** An amount of stored data in the largest fitting unit: `830 kB`, `2.4 MB` (`2,4 MB` in Swedish). */
export function dataSize(bytes: number, locale: string) {
  let value = Math.max(0, bytes)
  let unit = 0

  while (value >= 1000 && unit < dataUnits.length - 1) {
    value /= 1000
    unit += 1
  }

  const digits = unit === 0 || value >= 100 ? 0 : 1
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)

  return `${number} ${dataUnits[unit]}`
}

/** Playback speed as listeners read it: `1×`, `1.25×`. */
export function speedLabel(speed: number) {
  return `${Number(speed.toFixed(2))}×`
}

/**
 * The number a placeholder chapter title stands for, such as 1 for "001", "01" or "Chapter 001",
 * or null for a real title. Rips often leave chapters named only by number.
 */
export function chapterNumber(title: string | null | undefined) {
  const match = /^\s*(?:(?:chapter|kapitel|ch\.?|track)\s*)?0*(\d{1,3})\s*$/iu.exec(title ?? '')

  return match?.[1] ? Number(match[1]) : null
}
