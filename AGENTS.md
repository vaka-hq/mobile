# Vaka contributor guidance

Vaka is an Android-only Expo app. `README.md` covers setup and building; `docs/architecture.md`
explains how the app works. Keep both in step with changes in behaviour, and keep the README
short: how the app works belongs in `docs/`.

## Toolchain

- Vite+ (`vp`) runs everything: `vp install` for dependencies, `vp run <task>` for every task, and
  `vp exec <tool>` for a tool in `node_modules/.bin`. Tasks live in `vite.config.ts` (`run.tasks`);
  `package.json` keeps only the `prepare` hook. Do not run `pnpm run`, `npm`, `npx` or
  `node scripts/…` directly; the one pnpm command still used is `pnpm patch` / `pnpm patch-commit`
  for editing a patch in `patches/`.
- Scripts in `scripts/` are TypeScript, which Node runs as it is; each has a task, and a new script
  gets one too. They are linted and type-checked like the app.
- Tasks that read the translations depend on `i18n:compile`, so they compile the catalogs first.
  Tasks are not cached.
- The Node version is in `.node-version`; the pnpm version is `packageManager` in `package.json`.

## Layout

- Expo Router route files live in `src/app/` and only forward to screens in `src/screens/`.
- `src/ui/` is the app's vocabulary of components; `src/components/` holds larger pieces shared
  by screens; `src/library/` is persistence, orchestration and the TanStack Query hooks;
  `src/sources/` has one client per external service; `src/player/` owns playback; `src/media/`
  reads chapters from audio files; `src/settings/` holds preferences and secrets.
- `modules/` holds the app's own native modules: `android-components` (the Compose bridge and the
  e-book reader), `speech` (offline Vosk recognition) and `proxied-http` (reading through a proxy).

## Interface

- Build screens from `src/ui`, not from raw Expo UI. Add a named primitive when something is
  missing; screens must not name a Material Symbol or a colour role directly. New glyphs go in
  `src/ui/glyphs.ts`.
- Use Expo UI's Jetpack Compose components wherever one applies. Missing Material 3 pieces go in
  the focused Compose bridge `modules/android-components`, never as React Native look-alikes.
  The native Scaffold resolves slots once: keep bottom bar slots mounted.
- Every bottom sheet is `Sheet` from `src/ui/sheets.tsx`, on the native `ModalSheet` port of the
  reference app's PartialSheetDialog; never use Expo UI's ModalBottomSheet.
- Filter chips and search fields go in `Screen`'s `header`, which puts them with the title row in
  the bridged `HeaderAppBar`: all of it slides away as the list scrolls and takes the scrolled
  colour, as in the reference project (Listan). The list below uses `List`'s `underHeader`
  (`GatedListView`), which lets the bar slide only when its content overflows and then adds room
  at its foot so the content passes fully under the bar. A body with no list, such as `Empty`
  with `height='fill'` or `LoadingPage`, is centred by the bridged `BodyCentre` in what the
  keyboard leaves of the body; `imePadding` would take off the keyboard's whole height, too much
  on a tab, whose body already ends above the navigation bar.
- Expo UI 57 pitfalls seen on device: toggling `enabled` on an icon button inside an app bar slot
  removes it (guard the handler instead), and `NavigationBarItem.SelectedIcon` is not rendered
  (swap the icon source on focus). The tab bar is the bridged `ShortNavigationBar`; its icons are
  slots, so selection swaps the icon source the same way. `onVisibilityChanged` never reports a `Box` with nothing
  in it, so `LoadMore` always shows its spinner, and it asks again while it stays in view rather
  than waiting for its visibility to change.
- React Native keeps one back callback always on, which hides Android's predictive back-to-home.
  `SystemBack` (`src/components/system-back.tsx`, native `SystemBack.kt`) turns it off on the
  Library, the root screen, while the full player is closed, so Android owns Back there, as in
  the reference project. A JS `BackHandler` on that screen therefore never fires; anything that
  must catch Back there has to turn React Native's callback back on first. The native side reads
  a private field of `ReactActivity` and is pinned to React Native 0.86.3: review it when
  upgrading.
- Android colour roles follow Material 3: screens on `surface`, containers on
  `surfaceContainerHigh`, sheets on the default `surfaceContainerLow`, text `onSurface` and
  `onSurfaceVariant`. Colour comes from the dynamic palette; covers are the only imagery.
- Components that follow the player read only what they show with `usePlayerValue`, not the whole
  state from `usePlayer`, which changes several times a second while a book plays.
- Loading, failures and empty results fill the body, centred (`Empty` with `height='fill'`); a
  dialog is kept for what needs acting on, such as AudioBookBay going silent.
- Add user-facing strings through Lingui with translator comments. Extract, translate Swedish and
  compile before checking; compiled catalogs stay ignored. Keep "TorBox" out of user-facing copy
  outside Settings, the welcome screens and the start-up key check; elsewhere it is "your
  streaming service".

## Data and services

- Parse every external response at its boundary with zod (`src/sources/*`), and re-validate cached
  JSON when reading it (`src/library/repository.ts`). Keep each service's client independent.
- The request cache (`src/library/request-cache.ts`) falls back to an expired answer when a fresh
  one cannot be had, so pages open offline; failures are never stored.
- SQLite is used directly through `expo-sqlite` with parameterized SQL. Schema changes append a
  migration in `src/library/database.ts`; never edit shipped ones. Writes that belong together run
  in `withExclusiveTransactionAsync`.
- Hardcover and TorBox are reached with the listener's own API keys, entered in Settings and
  verified before they are stored. Keep secrets in `expo-secure-store`, never in SQLite or logs.
- TorBox: a download is followed by polling that slows down over time and while it is stalled or
  failing. The download guard only ever cancels torrents this app added.
- AudioBookBay blocks addresses that ask too often. Without a proxy, a request with no answer while
  the phone is online counts as a block (`src/library/abb-reader.ts`) and is never retried.
- Release builds only reach `https://` addresses; upgrade any `http://` link at its boundary.
- The preferred language (Settings, English by default; `src/library/languages.ts`, which reads
  the names and codes the sites use) ranks every list of sources: that language first, then
  English, then the others by name. It orders a book's recordings, by narrator and within each,
  and picks the default recording in it even over one ready at once in another language; it
  ranks a book's e-book files; and it orders Browse's audiobook and e-book results, each page on
  its own so nothing shown moves, except the latest uploads, which stay newest first.

## Playback

- Chapters and durations come from the media via range reads (`src/media`). Keep reads bounded and
  never download whole files for metadata.
- The player (`src/player/controller.ts`) is the only owner of the native audio player. Treat TorBox
  links as expiring: refresh stale links before resuming and recover from playback errors by
  requesting a fresh link at the current position, looking the torrent up again first.
- expo-audio is patched (`patches/`, applied by pnpm on install) for a back buffer, a disk cache that the player
  prefetches behind every seek, pausing when headphones are unplugged, and skip intervals for the
  notification set from the app's settings. It is built from source for that
  (`expo.autolinking` in `package.json`); keep both when upgrading it, editing the patch with
  `pnpm patch` and `pnpm patch-commit`.
- Books kept on the phone (`src/library/offline.ts`) play from their local copy; the player and the
  Listen buttons use it before asking TorBox for anything, so they work offline.
- Backups (`src/library/backup.ts`) hold the library, progress, bookmarks, series, e-book places
  and notes, and preferences, never caches or e-book files. Keys and the proxy sign-in go in only
  when the listener says yes when backing up. Restoring shows what the file holds first, then merges
  without overwriting newer data; keys only fill in ones the phone lacks.

## E-books and the reader

- E-books (`src/library/ebooks.ts`) are EPUBs from Anna's Archive (with the listener's member key:
  signed-in search and the `fast_download` API) or Library Genesis (no key). Choosing one only
  remembers it. On a book's page, a file not on the phone shows Download, which downloads it into
  the app's documents to stay, as the Storage sheet's download does; only then does it show Read,
  which never downloads. Once downloaded, its contents are read from the file natively
  (`readBookSections`), so choosing to continue from listening finds the place in the question
  itself, before the reader opens. Copies cached to read by older builds are moved there at start.
- Files found for a book are ranked in `src/library/ebook-rank.ts` (pure and tested): those by
  the book's author first, then by the preferred language, then the title and size decide.
  E-books download directly, never through torrents, so they are not checked for availability
  first.
- The reader is native: `BookView` in `modules/android-components`, where `EpubBook.kt` and
  `EpubHtml.kt` parse the EPUB with Android's zip and XML parsers, `BookLayout.kt` lays it out with
  Compose text and `BookView.kt` paginates and draws it, slides pages as they turn and draws the
  overview's row of cards. It takes JSON commands and reports JSON events, parsed with zod in
  `src/components/reader-view.tsx`; its bars and sheets are Compose over it (`src/ui/reader.tsx`).
- The book only turns pages; there is no scrolling layout. The display settings are not a sheet
  but a card over the foot of the page being read, the overview closing for it, so changes show at
  full size; the reader centres its loading indicator above the card.
- The reading theme, light or dark and the phone's until one is picked, colours only the page and
  its text; the bars, sheets and panel follow the phone like the rest of the app.
- Tapping the page's top end corner bookmarks it: `BookView.kt` moves the ribbon at once and
  reports a `bookmark` event for the app to keep; a bookmark changed anywhere else plays the same
  ribbon. Pulling down anywhere on the page reports `pullDown`, and the top bar alone slides in
  over the page, without the overview; pulling up reports `pullUp` and puts it away.
- Selection is the reader's own, not Compose's: `SelectionContainer` cannot say what is selected,
  and text fields would split selection at paragraphs and drift on justified lines. It behaves as
  Android's does: a long press selects a word with a vibration, dragging it or its handles ticks at
  each character under the system magnifier, and once the finger lifts Android's floating text
  toolbar offers Highlight and Note (carried out by the app, the highlight in the colour used last),
  Copy, Share and the apps that act on text, such as Translate (found through the `PROCESS_TEXT`
  query in the module's manifest). A long press inside the system's gesture edges is Android's back
  gesture, not a selection, and a touch Android takes over drops the selection.
- Places are `vaka:chapter/block/offset`; a saved place it cannot read opens at the reading
  progress, and a highlight whose place it cannot read is found by its text.
- Only the chapters beside the one being read are kept laid out, and only the pages on screen are
  drawn. Before a book shows, every chapter's pages are counted in parallel behind a loading
  indicator and the counts are cached per book, layout setting and page size; raise
  `pageCountVersion` in `BookView.kt` whenever layout changes, or old counts will be reused.

## Listening and reading

- Listening and reading meet in the same book (`src/library/reading-sync.ts`, pure and tested, and
  `src/library/listening-reading.ts`): the audiobook's chapters are paired with the e-book's
  contents by title, then by order, and a place keeps its share of its chapter.
- The two places are tracked apart and only meet when the listener says so: before the reader
  opens after newer listening, or before playback starts after newer reading (the controller's
  play gate), the shared prompt (`src/components/place-prompt.tsx`) asks where to start; the
  switch buttons in the player's and the reader's bars carry the place over without asking.
  Listening picks up at the top of the page reading reached, and the reader marks the sentence it
  picks up from. Finding a place stops when the listener cancels.
- The exact mode (`readingSync: 'words'`) hears a short stretch of the audio with the offline Vosk
  recognizer in `modules/speech`, never the microphone, and finds the words in the text. Its
  English model is downloaded when that mode is chosen in Settings and deleted when it is left;
  it is never shipped with the app.

## Builds and devices

- Every build is local; the app uses no Expo cloud services or over-the-air updates.
- Do not edit the generated `android/` folder; use config plugins (`app.config.ts`) and
  `modules/`. Native dependency or module changes need `vp run generate` and a rebuild.
- The variant (`APP_VARIANT`: development, preview, production) is fixed when `android/` is
  generated; give Gradle the same `APP_VARIANT`, since release builds read the config again. After
  building another variant, regenerate `android/` for development.
- Release builds are minified with R8, split into one APK per CPU architecture, and signed with
  the owner's key from `~/.gradle/gradle.properties` (`VAKA_UPLOAD_*`); a production release
  refuses the debug key. Raise `android.versionCode` for each release.
- The app icon, splash mark and themed icon come from `scripts/generate-icons.ts`
  (`vp run icons:generate`). The licences under Settings come from
  `scripts/generate-licenses.ts`; run it after changing dependencies, and update its list of
  native libraries when those change.
- After any native change, always install the rebuilt app on the owner's phone (connected over
  wireless adb) as well as any emulator used for testing. Test only on the emulator: never launch,
  tap through or otherwise drive the owner's phone; it only receives the installed build.

## Before finishing

- Run `vp run check` (it auto-fixes) and `vp run export` before considering work complete.
- Report native build and device verification separately; static checks do not establish playback.
