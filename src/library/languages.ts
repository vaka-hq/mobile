/**
 * The languages books can be preferred in, by ISO 639-1 code, with the ways the sites name them:
 * English names, the language's own name without accents, and its two- and three-letter codes.
 * The preferred one ranks first wherever sources are listed, English next.
 */
export const languages = {
  en: ['english', 'eng', 'en'],
  sv: ['swedish', 'svenska', 'swe', 'sv'],
  es: ['spanish', 'espanol', 'castellano', 'spa', 'es'],
  de: ['german', 'deutsch', 'ger', 'deu', 'de'],
  fr: ['french', 'francais', 'fre', 'fra', 'fr'],
  it: ['italian', 'italiano', 'ita', 'it'],
  pt: ['portuguese', 'portugues', 'por', 'pt'],
  nl: ['dutch', 'nederlands', 'flemish', 'dut', 'nld', 'nl'],
  da: ['danish', 'dansk', 'dan', 'da'],
  no: ['norwegian', 'norsk', 'bokmal', 'nynorsk', 'nor', 'nob', 'nno', 'nb', 'nn', 'no'],
  fi: ['finnish', 'suomi', 'fin', 'fi'],
  is: ['icelandic', 'islenska', 'ice', 'isl', 'is'],
  pl: ['polish', 'polski', 'pol', 'pl'],
  cs: ['czech', 'cestina', 'cze', 'ces', 'cs'],
  sk: ['slovak', 'slovencina', 'slo', 'slk', 'sk'],
  hu: ['hungarian', 'magyar', 'hun', 'hu'],
  ro: ['romanian', 'romana', 'rum', 'ron', 'ro'],
  bg: ['bulgarian', 'bul', 'bg'],
  el: ['greek', 'ellinika', 'gre', 'ell', 'el'],
  tr: ['turkish', 'turkce', 'tur', 'tr'],
  ru: ['russian', 'rus', 'ru'],
  uk: ['ukrainian', 'ukr', 'uk'],
  sr: ['serbian', 'srpski', 'srp', 'sr'],
  hr: ['croatian', 'hrvatski', 'hrv', 'hr'],
  sl: ['slovenian', 'slovene', 'slovenscina', 'slv', 'sl'],
  et: ['estonian', 'eesti', 'est', 'et'],
  lv: ['latvian', 'latviesu', 'lav', 'lv'],
  lt: ['lithuanian', 'lietuviu', 'lit', 'lt'],
  ca: ['catalan', 'catala', 'cat', 'ca'],
  eu: ['basque', 'euskara', 'baq', 'eus', 'eu'],
  gl: ['galician', 'galego', 'glg', 'gl'],
  ga: ['irish', 'gaeilge', 'gle', 'ga'],
  cy: ['welsh', 'cymraeg', 'wel', 'cym', 'cy'],
  af: ['afrikaans', 'afr', 'af'],
  ar: ['arabic', 'ara', 'ar'],
  he: ['hebrew', 'heb', 'he'],
  fa: ['persian', 'farsi', 'per', 'fas', 'fa'],
  hi: ['hindi', 'hin', 'hi'],
  bn: ['bengali', 'bangla', 'ben', 'bn'],
  ur: ['urdu', 'urd', 'ur'],
  id: ['indonesian', 'bahasa indonesia', 'ind', 'id'],
  ms: ['malay', 'bahasa melayu', 'may', 'msa', 'ms'],
  vi: ['vietnamese', 'tieng viet', 'vie', 'vi'],
  th: ['thai', 'tha', 'th'],
  tl: ['tagalog', 'filipino', 'fil', 'tgl', 'tl'],
  zh: ['chinese', 'mandarin', 'chi', 'zho', 'zh'],
  ja: ['japanese', 'jpn', 'ja'],
  ko: ['korean', 'kor', 'ko'],
  sw: ['swahili', 'kiswahili', 'swa', 'sw'],
  eo: ['esperanto', 'epo', 'eo'],
  la: ['latin', 'lat', 'la'],
} satisfies Record<string, string[]>

export type Language = keyof typeof languages

export const defaultLanguage: Language = 'en'

export function isLanguage(value: string): value is Language {
  return Object.hasOwn(languages, value)
}

/** Lower case, without accents or a trailing code in brackets, such as "English [en]". */
function plain(text: string) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\[[^\]]*\]/gu, '')
    .trim()
    .toLowerCase()
}

/**
 * The code of the language a site names, or null for one not listed or not named. Something in
 * several languages, such as "English; Spanish", counts as in the first.
 */
export function languageCode(name: string | null) {
  const first = plain(name?.split(/[;,/]/u)[0] ?? '')

  if (!first) {
    return null
  }

  for (const [code, names] of Object.entries(languages)) {
    if (names.includes(first)) {
      return code
    }
  }

  return null
}

/**
 * Orders by language: the preferred one first, then English, then the others by name, and what
 * names none last. Two things in the same language compare equal.
 */
export function compareLanguages(preferred: string) {
  const rank = (language: string | null) => {
    const code = languageCode(language)

    if (code === preferred) {
      return 0
    }

    if (code === 'en') {
      return 1
    }

    return language ? 2 : 3
  }

  return (a: string | null, b: string | null) =>
    rank(a) - rank(b) || (rank(a) === 2 ? plain(a ?? '').localeCompare(plain(b ?? '')) : 0)
}

/**
 * Things in language order alone, as a list of search results shows them: the preferred language
 * first, then English, then the others by name, each language in its original order.
 */
export function byPreferredLanguage<T extends { language: string | null }>(
  items: T[],
  preferred: string,
) {
  const byLanguage = compareLanguages(preferred)

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => byLanguage(a.item.language, b.item.language) || a.index - b.index)
    .map(({ item }) => item)
}
