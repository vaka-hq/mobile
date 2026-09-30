import { plural } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import * as Linking from 'expo-linking'
import { useFeedback } from '@/lib/feedback'
import { useTorrentSwarm } from '@/library/queries'
import { usePreferences } from '@/settings/preferences'
import type { AbbBook } from '@/sources/audiobookbay/parse'
import type { Glyph } from '@/ui/glyphs'
import { CardItem, GlyphIcon } from '@/ui/primitives'
import { Sheet, SheetList } from '@/ui/sheets'

type Fact = { key: string; glyph: Glyph; label: string; value: string | null; onPress?: () => void }

/**
 * Everything known about one upload, held down on the source list: who is sharing it, what it is
 * and a link to its post, which opens in the browser.
 */
export function SourceInfoSheet({
  post,
  title,
  cached,
  onDismiss,
}: {
  post: AbbBook
  /** The row's own label, such as “M4B · 128 Kbps”. */
  title: string
  /** Whether it plays right away; null while that is unknown. */
  cached: boolean | null
  onDismiss: () => void
}) {
  const { t } = useLingui()
  const { abbBaseUrl } = usePreferences()
  const { showFeedback } = useFeedback()
  const swarm = useTorrentSwarm(post)
  const postUrl = `${abbBaseUrl}/abss/${encodeURIComponent(post.id)}/`
  const seeders = swarm.data?.seeds ?? 0
  const peers = swarm.data?.peers ?? null
  const fileCount = post.files.length

  const sharing = swarm.isPending
    ? t({ message: 'Checking…', comment: 'Upload details while its seeders are looked up' })
    : swarm.data
      ? [
          t({
            message: plural(seeders, { one: '# seeder', other: '# seeders' }),
            comment: 'How many people share the whole upload',
          }),
          peers === null
            ? null
            : t({
                message: plural(peers, { one: '# peer', other: '# peers' }),
                comment: 'How many people share parts of the upload',
              }),
        ]
          .filter(Boolean)
          .join(' · ')
      : t({ message: 'Unknown', comment: 'Upload details when its trackers did not answer' })

  const facts: Fact[] = [
    {
      key: 'sharing',
      glyph: swarm.data?.dead ? 'dead' : 'seeders',
      label: t({ message: 'Sharing', comment: 'Upload detail: seeders and peers' }),
      value: sharing,
    },
    {
      key: 'availability',
      glyph: cached ? 'cached' : 'download',
      label: t({ message: 'Availability', comment: 'Upload detail: plays at once or downloads' }),
      value:
        cached === null
          ? null
          : cached
            ? t({ message: 'Plays right away', comment: 'Upload detail: already cached' })
            : t({
                message: 'Downloads before it plays',
                comment: 'Upload detail: must be downloaded first',
              }),
    },
    {
      key: 'title',
      glyph: 'title',
      label: t({ message: 'Post title', comment: 'Upload detail' }),
      value: post.title,
    },
    {
      key: 'narrator',
      glyph: 'narrator',
      label: t({ message: 'Narrator', comment: 'Upload detail' }),
      value: post.narrator,
    },
    {
      key: 'format',
      glyph: 'audioFormat',
      label: t({ message: 'Format', comment: 'Upload detail' }),
      value: [post.format, post.bitrate].filter(Boolean).join(' · ') || null,
    },
    {
      key: 'size',
      glyph: 'size',
      label: t({ message: 'Size', comment: 'Upload detail' }),
      value: post.totalSize,
    },
    {
      key: 'files',
      glyph: 'files',
      label: t({ message: 'Files', comment: 'Upload detail' }),
      value:
        post.files.length > 0
          ? t({
              message: plural(fileCount, { one: '# file', other: '# files' }),
              comment: 'Upload detail: how many files it holds',
            })
          : null,
    },
    {
      key: 'language',
      glyph: 'language',
      label: t({ message: 'Language', comment: 'Upload detail' }),
      value: post.language,
    },
    {
      key: 'posted',
      glyph: 'posted',
      label: t({ message: 'Posted', comment: 'Upload detail: when it was uploaded' }),
      value: post.postedAt,
    },
    {
      key: 'post',
      glyph: 'link',
      label: t({ message: 'Open the post', comment: 'Opens the upload’s page in the browser' }),
      value: postUrl,
      onPress: () => {
        Linking.openURL(postUrl).catch(() =>
          showFeedback(
            t({
              message: 'No app on this phone can open the link.',
              comment: 'Opening an upload’s page failed because there is no browser',
            }),
          ),
        )
      },
    },
  ]

  const shown = facts.filter((fact) => fact.value)

  return (
    <Sheet title={title} onDismiss={onDismiss}>
      {() => (
        <SheetList>
          {shown.map((fact, index) => (
            <CardItem
              key={fact.key}
              card={{ index, count: shown.length }}
              leading={{ glyph: fact.glyph }}
              headline={fact.label}
              supporting={fact.value}
              action={fact.onPress ? <GlyphIcon glyph='external' /> : undefined}
              onPress={fact.onPress}
            />
          ))}
        </SheetList>
      )}
    </Sheet>
  )
}
