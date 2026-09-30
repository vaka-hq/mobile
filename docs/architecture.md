# How Vaka works

How the app is put together and why it behaves as it does. For setting up and building, see the
[README](../README.md); for the rules to follow when changing it, see [AGENTS.md](../AGENTS.md).

## Books and streams

The library holds books, not uploads. A book is a Hardcover book, or an AudioBookBay post that
Hardcover does not know; each upload of it is a _stream_ with its own TorBox torrent, chapters,
progress and bookmarks (recordings differ in length, so positions do not carry across). A book
remembers the stream last chosen or played and opens with it.

## Code map

- `src/app/` owns only routing. Route files forward to screens in `src/screens/`. The root stack
  holds the tab group (Library at `/` and Browse at `/browse`), `welcome`, `settings`,
  `licenses`, `book/[id]` (an AudioBookBay post), `book/[id]/match`, `work/[id]` (a Hardcover
  book's page), `work/[id]/streams`, `work/[id]/ebooks` and `read/[md5]`. The player floats over
  every route in the player layer; series, chapters and bookmarks are sheets.
- `src/ui/` is the app's own vocabulary drawn with Expo UI's Jetpack Compose components:
  `Screen`, `Action`, `List`, `BookRow`, `Cover`, `InfoRow`, `Notice`,
  `Empty`, `Loading`, `LoadMore`, `ChipRow`, `SearchField`, the speed and sleep sheets and the
  dialogs. Screens name what a thing is; only `src/ui/glyphs.ts` names Material Symbols.
- `modules/android-components` bridges the Material 3 pieces Expo UI lacks: the `Scaffold`
  with its snackbar, the top app bars and the collapsing `HeaderAppBar` with its `GatedListView`
  and `BodyCentre`,
  the `ShortNavigationBar` under the tabs, the `ModalSheet` behind every bottom sheet, connected
  button groups, `CoverImage` (Coil, covers decoded at display size with a placeholder in their
  dominant colour), and the native e-book reader, `BookView`. Each screen is one Compose tree
  inside a `Host`; the tab bar and mini player share another.
- `modules/speech` runs the offline Vosk recogniser on a stretch of audio, for finding a reading
  place in a recording; `modules/proxied-http` reads pages through an HTTP proxy;
  `modules/app-updates` checks a downloaded update and hands it to Android's installer.
- `src/sources/` holds one client per service: `audiobookbay` (HTML parsing of listings and posts),
  `hardcover` (API key, GraphQL and matching), `torbox` (REST client and track selection),
  `annas-archive` and `libgen` (e-book search and downloads), `ip-check` (the proxy's exit
  address) and `github` (the app's own releases).
- `src/media/` reads chapters and durations from the streamed files with HTTP Range requests.
- `src/library/` is local persistence (expo-sqlite), the orchestration of loading, matching and
  preparing books, stream-link caching and TanStack Query hooks.
- `src/player/` is the single playback controller, its React hooks and derived summaries.
- `src/settings/` keeps preferences in SQLite and secrets in the Android keystore.
- `src/i18n/` selects English or Swedish from the device, confirming locale changes before
  activation. User-facing text uses Lingui macros with translator comments.

## How streaming works

1. **AudioBookBay** listings and posts are parsed from the site's HTML. A post yields its title,
   author, narrator, description, categories, format, file list, info hash and trackers; the magnet
   link is built from those. The address is configurable in Settings for when the site moves.
2. **Hardcover** is matched automatically the first time a book opens (title and author search,
   scored by word overlap, accepted at 0.6 or better). The listener can pick another book or none in
   the match screen; their choice is never overwritten. Cover, title, authors, narrators, series,
   description and the audiobook edition are cached with the book. The edition is the one whose
   narrator matches the post (preferring its language, a cover and popularity), falling back to
   Hardcover's default audio edition.
   With a Hardcover key, **Browse** finds books on Hardcover first. A book's page searches
   AudioBookBay by title and author (the title alone when that finds little), keeps posts whose
   title contains the book's title and whose author matches, and opens up to 16 of them, three at
   a time, to read their narrators. Uploads are grouped by narrator under the matching Hardcover
   audiobook edition (publisher, year, length, language), M4B first, and TorBox's cache is checked
   for all of them in one request. The book page plays the chosen stream: the one picked there,
   the one opened from a post, the remembered one, or else the most read narrator's recording
   from its best source (one TorBox has cached, else M4B over M4A over MP3, higher bitrate, newer).
   The book page shows Hardcover's cover and details with Listen and Add to library as connected
   spring buttons; one row opens the narrator and source choice (`work/[id]/streams`). Choosing or playing a stream links it to the book with that recording's
   edition and remembers it. Posts opened from AudioBookBay results go to their Hardcover book
   with that stream chosen; unmatched posts show, and are collected, on their own. A recording
   matched to the wrong book can be matched again from the book page's menu (**Wrong book?**).
   Before a search, Browse shows Hardcover: this month's trending books, or a genre's books ordered by
   how many readers gave them that genre (genre chips are Hardcover's most used genres). The
   AudioBookBay chip searches posts directly, as without a key. The Series chip searches Hardcover
   series (dropping the empty ones Hardcover keeps for narrators); a series lists one book per
   position in reading order, without omnibus editions, translations or duplicate records.
   Every search pages in as the list scrolls.
3. **TorBox**: the book page checks the listener's torrents by ID and hash, then the cache; of a
   torrent added twice, the finished copy wins. Listening adds the magnet when needed (a queued
   torrent says so), waits briefly for cached torrents, and follows a download closely at first and
   then less often, and seldom while it is stalled or TorBox cannot be reached; a failed check
   says so instead of showing old progress. TorBox downloads one torrent at a time on some plans,
   so starting a download offers to cancel the app's other downloads first, never the listener's
   own torrents. The torrent's `.m4b`, `.m4a` and `.mp3` files become the book's tracks in natural
   order.
4. **Chapters and durations** come from the media itself before playback: MP4 files are walked box
   by box to `moov` (a QuickTime chapter track wins over Nero `chpl`), MP3 files give ID3v2 `CHAP`
   frames and Xing/VBRI or constant-bitrate lengths. Only metadata ranges are downloaded (capped at
   12 MB). Multi-file books without embedded markers get one chapter per file; books with more than
   24 files estimate lengths from the bitrate, and the player corrects each file as it loads.
5. **Playback** uses one `expo-audio` player with its Android media session: background audio, the
   media notification and lock screen controls (play/pause, skip back and forward by the intervals
   set in Settings, seek). It pauses when headphones are unplugged or Bluetooth disconnects. Tracks
   change by swapping the source, so the session survives multi-file books. expo-audio is patched
   (`patches/`) for a back buffer, a disk cache prefetched behind every seek, the pause on unplug
   and the skip intervals.
6. **Expiring links**: TorBox links are signed and temporary. Links are reused for at most an hour;
   resuming after that reloads the source at the saved position first, and any playback error
   requests a fresh link, looking the torrent up again in case it was added anew, and resumes where
   it stopped (three attempts a minute before showing the error with Retry, or with the way to
   Settings when the key is missing or refused).

Progress is saved every five seconds while playing, on pause, on track changes and when the app
leaves the foreground. The last unfinished book is restored, paused, on launch.

## Preferred language

A language chosen in Settings, English by default, ranks every list of sources: recordings and
their default, e-book files, and Browse's results come in that language first, then English,
then the others by name.

## E-books and the reader

A book's e-books are found on Anna's Archive (with the listener's member key) and Library Genesis,
EPUB only. Choosing one only remembers it; reading downloads it to stay, as the Storage sheet
does. The reader is native (`BookView` in `modules/android-components`): it lays the EPUB out with
Compose text, turns pages, and keeps highlights with notes, bookmarks, contents and search.
Selecting text works as it does elsewhere on Android, with a vibration, the magnifier and the
floating text toolbar, whose Highlight and Note the app carries out. Its
display settings are a card over the page. Listening and reading keep their own places and meet
when the listener says so: the switch buttons carry the place over, and opening one after newer
progress in the other asks where to start. The exact mode listens to a few seconds of the audio
with the offline Vosk recogniser (`modules/speech`) to find the words on the page. Its model is
downloaded when the mode is chosen, picking up where a dropped connection left off rather than
starting over.

## Offline, storage and backups

A recording can be downloaded to the phone and then plays without TorBox or a connection;
downloads resume one book at a time after the app restarts, and a failed one says so in the
Storage sheet, where tapping it tries again. Settings → Storage lists downloaded audiobooks and
e-books and clears caches.

A backup (Settings → Backup) holds the library, progress, bookmarks and notes, followed series, e-book
places and highlights, and preferences; keys and the proxy sign-in only when the listener says so.
Restoring shows what the file holds first and merges without overwriting newer data. The welcome
screen can restore a backup too.

## AudioBookBay and the proxy

AudioBookBay blocks addresses that ask too often, often for a few days. Pages can go through an
HTTP proxy saved in Settings. Without one, a request that gets no answer at all while the phone
is online counts as a block: the listener is told once, with the way to Settings, and Browse says
so in place of the results.

## Persistence

SQLite (`vaka.db`, migrated with `PRAGMA user_version`) stores library books (`works`: the
Hardcover book, library state, recency and the current stream), streams (`books`: AudioBookBay and
Hardcover JSON, torrent, tracks, durations, chapters), playback position and speed and bookmarks
per stream, and preferences. Cached JSON is validated with the same
zod schemas as the network boundary. AudioBookBay details refresh once a day. Every other
AudioBookBay and Hardcover catalogue answer goes through one request cache (`request_cache`,
parsed JSON validated again on read, failures never stored): the latest uploads for 15 minutes,
searches and genre pages for 2 hours, Hardcover searches and books for a day. When a fresh answer
cannot be had, such as offline, the last one kept is used however old it is, so a book's page
still opens. Refreshing a Hardcover match skips it; key checks and TorBox are never cached.
Settings → Clear cached data forgets browsed books, cached answers and links but keeps the library,
progress and bookmarks. Multi-step writes run in exclusive transactions.

The API keys and the proxy sign-in live in `expo-secure-store`; one that can no longer be
decrypted, such as after the keystore was reset, reads as missing instead of stopping the app.

## Hardcover keys

Create a personal API key at hardcover.app → Settings → Hardcover API with catalogue read access
(`read:catalog`) and paste it into Settings → Hardcover; a pasted `Bearer ` prefix is accepted.
The key is verified with a one-book catalogue query before it is stored, and a stored key is
re-checked whenever Settings opens, so an expired or revoked key shows up there. Hardcover's
answers name the problem: a rejected key, a missing `read:catalog` permission or the rate limit.
Without a key the app works with AudioBookBay details. Hardcover's personal keys expire on the date
chosen when creating them; replace the key in Settings when that happens.

## Builds

Every build is made locally; the app uses no Expo cloud services and has no over-the-air
updates, so every change ships in a build. The variant is chosen when the Android project is
generated: `APP_VARIANT=<variant> vp run generate` writes that variant's package, name and
scheme into `android/`, and Gradle is given the same `APP_VARIANT`, since a release build bundles
the JavaScript and reads the config again. Any variant builds as debug or release; a preview
release is a minified build that installs beside the development app.

A release build makes one APK per CPU architecture (`app-arm64-v8a-release.apk` and so on), each
with only that architecture's native libraries; install the one that matches the phone, which is
`arm64-v8a` for any recent one. `vp run android:release` picks it for the connected device.
Debug builds stay whole.

Release builds enable R8 minification and resource shrinking, and only reach `https://`
addresses, so AudioBookBay's address and covers are always asked for over HTTPS.

## Releases and updates

Releases are built by GitHub Actions (`.github/workflows/release.yml`) and published as GitHub
releases of `vaka-hq/mobile`, signed with the owner's upload key, which the workflow reads from
the `release` environment's secrets. There are two channels:

- **Stable**: pushing a tag that starts with `v` releases that commit under the tag's name, such as
  `v1.1.0` for 1.1.0. The name can be anything; the habit is to tag the commit of a nightly that
  has been used for a while.
- **Nightly**: once a day, and when the workflow is run by hand, `main` becomes a pre-release
  tagged with the date and the workflow's run number, `nightly-20261001.42`, when it has changed
  since the last nightly; the run number never repeats and finds the run in Actions. It is named
  after the last stable release and the commit built, `1.1.0-nightly.20261001.42+c2fa9fc`, or
  `0.0.1-nightly.…` before the first, so Settings shows which commit is running. The newest ten
  are kept.

The workflow gives the build its name and version code (`VAKA_VERSION_NAME` and
`VAKA_VERSION_CODE`, read by `app.config.ts`). The code is the build time in minutes since 2026,
so every release, of either channel, installs over the builds before it; local builds are 0.0.1
with code 1. Each release holds one APK per CPU architecture, `vaka-<name>-<abi>.apk` (the name
without a nightly's `+commit`), and an `update.json` with the name, code and channel.
`.github/workflows/ci.yml` runs the checks and bundles the JavaScript for every pull request and
push to `main`.

The production app updates itself (`src/library/app-updates.ts`). Settings chooses the channel,
Stable by default, and checks by hand; the app also checks once a day when it opens. It reads the
repository's recent releases from GitHub's public API, takes the newest full release for Stable
or the newest of any for Nightly (`src/library/update-release.ts`, pure and tested), and offers it
when its `update.json` has a higher version code than the running build. Later puts that version
off until the listener asks. Updating downloads the APK for the phone's CPU, checks it against the
SHA-256 checksum GitHub records for every release file, and hands it to Android's installer
through a `PackageInstaller` session (`modules/app-updates`). The app must first be allowed to
install apps, which opens that setting the first time; on Android 12 and later an app so allowed
may then update itself without asking again. Android refuses an update not signed with the same
key. Moving from Nightly to Stable waits for a stable release newer than the running build, since
Android never installs an older version code.
