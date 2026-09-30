import * as SQLite from 'expo-sqlite'

/**
 * Ordered schema migrations; `PRAGMA user_version` records how many have run. Append new steps,
 * never edit shipped ones.
 */
const migrations = [
  `
  CREATE TABLE books (
    id TEXT PRIMARY KEY NOT NULL,
    abb TEXT NOT NULL,
    abb_fetched_at INTEGER NOT NULL,
    hardcover_id INTEGER,
    hardcover TEXT,
    match_state TEXT NOT NULL DEFAULT 'pending',
    torrent_id INTEGER,
    tracks TEXT,
    durations TEXT,
    chapters TEXT,
    in_library INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER,
    last_played_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX books_library ON books (in_library, added_at DESC);
  CREATE INDEX books_recent ON books (last_played_at DESC);

  CREATE TABLE playback (
    book_id TEXT PRIMARY KEY NOT NULL REFERENCES books (id) ON DELETE CASCADE,
    track INTEGER NOT NULL,
    position REAL NOT NULL,
    speed REAL NOT NULL DEFAULT 1,
    finished INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT NOT NULL REFERENCES books (id) ON DELETE CASCADE,
    track INTEGER NOT NULL,
    position REAL NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX bookmarks_book ON bookmarks (book_id, track, position);

  CREATE TABLE stream_urls (
    torrent_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (torrent_id, file_id)
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
  // TorBox links carry the account's API key, so they are no longer written to disk.
  `
  DROP TABLE stream_urls;
  `,
  // Hardcover details now follow the posted recording's edition, so matched books fetch them again.
  `
  UPDATE books SET hardcover = NULL WHERE hardcover IS NOT NULL;
  `,
  // Parsed AudioBookBay listings and Hardcover catalogue answers, so repeats skip the network.
  `
  CREATE TABLE request_cache (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX request_cache_expiry ON request_cache (expires_at);
  `,
  // Hardcover details now keep the cover's colour and shape; matched books fetch them again.
  `
  UPDATE books SET hardcover = NULL WHERE hardcover IS NOT NULL;
  `,
  // The library holds books, not uploads: a Hardcover book (or an unmatched post) remembers the
  // stream last used. Saved and played uploads carry over; the most recently played one wins.
  `
  CREATE TABLE works (
    id TEXT PRIMARY KEY NOT NULL,
    hardcover_id INTEGER,
    work TEXT,
    stream_id TEXT REFERENCES books (id) ON DELETE SET NULL,
    in_library INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER,
    last_played_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX works_library ON works (in_library, added_at DESC);
  CREATE INDEX works_recent ON works (last_played_at DESC);

  INSERT INTO works (id, hardcover_id, stream_id, in_library, added_at, last_played_at, updated_at)
    SELECT
      CASE WHEN hardcover_id IS NULL THEN 'post:' || id ELSE 'hardcover:' || hardcover_id END,
      hardcover_id, id, in_library, added_at, last_played_at, updated_at
    FROM books
    WHERE in_library = 1 OR last_played_at IS NOT NULL
    ORDER BY coalesce(last_played_at, 0)
  ON CONFLICT (id) DO UPDATE SET
    stream_id = excluded.stream_id,
    in_library = max(works.in_library, excluded.in_library),
    added_at = coalesce(works.added_at, excluded.added_at),
    last_played_at = coalesce(excluded.last_played_at, works.last_played_at),
    updated_at = excluded.updated_at;
  `,
  // Narrators are now also read from description credit lines; saved posts without one reload.
  `
  UPDATE books SET abb_fetched_at = 0 WHERE json_extract(abb, '$.narrator') IS NULL;
  `,
  // Whole series in the library: every book of a followed series is added, new ones included.
  `
  CREATE TABLE series (
    id INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    known_books TEXT NOT NULL DEFAULT '[]',
    added_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // Books kept on the phone to play without a connection, and books marked finished by hand.
  `
  CREATE TABLE offline_books (
    book_id TEXT PRIMARY KEY NOT NULL REFERENCES books (id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    bytes INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  ALTER TABLE works ADD COLUMN finished_at INTEGER;
  `,
  // E-books to read, kept on the phone, with where the reader is and what they marked.
  `
  CREATE TABLE ebooks (
    md5 TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '[]',
    publisher TEXT,
    year TEXT,
    language TEXT,
    size TEXT,
    cover_url TEXT,
    work_id TEXT,
    status TEXT NOT NULL,
    bytes INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    location TEXT,
    progress REAL NOT NULL DEFAULT 0,
    chapter TEXT,
    added_at INTEGER NOT NULL,
    last_read_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX ebooks_work ON ebooks (work_id);

  CREATE TABLE ebook_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    md5 TEXT NOT NULL REFERENCES ebooks (md5) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    cfi TEXT NOT NULL,
    text TEXT,
    note TEXT,
    color TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX ebook_marks_book ON ebook_marks (md5, kind);
  `,
  // The e-book chosen to read a book, the latest choice winning over files kept before.
  `
  ALTER TABLE ebooks ADD COLUMN chosen_at INTEGER;
  `,
  // Marks name their place as the reader writes it, which is no longer only an EPUB CFI.
  `
  ALTER TABLE ebook_marks RENAME COLUMN cfi TO location;
  `,
  // Where each part of an e-book starts and the words where reading stopped, to meet listening.
  `
  ALTER TABLE ebooks ADD COLUMN sections TEXT;
  ALTER TABLE ebooks ADD COLUMN passage TEXT;
  `,
  // The page reading stopped on and how many there are, to say where the reading place is.
  `
  ALTER TABLE ebooks ADD COLUMN page INTEGER;
  ALTER TABLE ebooks ADD COLUMN pages INTEGER;
  `,
  // When each cached answer was last used, so the cache lets the least used go past its size.
  `
  ALTER TABLE request_cache ADD COLUMN used_at INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX request_cache_used ON request_cache (used_at);
  `,
]

function open() {
  const database = SQLite.openDatabaseSync('vaka.db')

  database.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

  const version =
    database.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0

  for (let index = version; index < migrations.length; index += 1) {
    database.withTransactionSync(() => {
      database.execSync(migrations[index] ?? '')
      database.execSync(`PRAGMA user_version = ${index + 1}`)
    })
  }

  return database
}

export const database = open()
