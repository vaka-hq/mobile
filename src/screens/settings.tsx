import { plural } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { useQuery } from '@tanstack/react-query'
import * as Application from 'expo-application'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useBackupRestore } from '@/components/backup-restore'
import { type ProxyFields, useProxySetup } from '@/components/proxy-setup'
import { AudiobookDownloadsSheet, EbookDownloadsSheet } from '@/components/storage-sheets'
import { useFeedback } from '@/lib/feedback'
import { queryClient } from '@/lib/query-client'
import { exportBackup, hasSecrets } from '@/library/backup'
import { clearEbookCache, ebookBytes, ebookCacheBytes, useEbooks } from '@/library/ebooks'
import { invalidateLibrary } from '@/library/invalidation'
import { isLanguage } from '@/library/languages'
import { offlineBytes, useOfflineBooks } from '@/library/offline'
import { cachedMetadataSize, clearCachedMetadata } from '@/library/repository'
import {
  installSpeechModel,
  removeSpeechModel,
  speechModelBytes,
  useSpeechModel,
} from '@/library/speech-model'
import { forgetStreamUrls } from '@/library/streams'
import { audioCacheSize, clearAudioCache } from '@/player/controller'
import { type AbbProxy, setAbbProxy, useAbbProxy } from '@/settings/abb-proxy'
import {
  connectAnnas,
  connectHardcover,
  connectTorBox,
  useAnnasAccount,
  useHardcoverAccount,
  useProxyCheck,
  useTorBoxAccount,
} from '@/settings/account-checks'
import { annasKey, useAnnasKey } from '@/settings/annas-key'
import { hardcoverKey, useHardcoverKey } from '@/settings/hardcover-key'
import { useKeyProblems } from '@/settings/key-problems'
import {
  playbackSpeeds,
  setPreference,
  skipIntervals,
  usePreferences,
} from '@/settings/preferences'
import { torBoxKey, useTorBoxKey } from '@/settings/torbox-key'
import { AnnasKeyError } from '@/sources/annas-archive/client'
import { normalizeBaseUrl } from '@/sources/audiobookbay/client'
import { isAuthenticationError } from '@/sources/torbox/client'
import { ChoiceDialog, ConfirmDialog, FormDialog, TextDialog } from '@/ui/dialogs'
import { useErrorText } from '@/ui/errors'
import { dataSize, speedLabel } from '@/ui/format'
import { useLanguageNames } from '@/ui/languages'
import { Group, List } from '@/ui/primitives'
import { Screen } from '@/ui/screen'

type Dialog =
  | 'torbox'
  | 'removeTorbox'
  | 'hardcover'
  | 'removeHardcover'
  | 'speed'
  | 'skipBack'
  | 'readingSync'
  | 'skipForward'
  | 'source'
  | 'annas'
  | 'removeAnnas'
  | 'annasAddress'
  | 'libgenAddress'
  | 'preferredLanguage'
  | 'proxy'
  | 'removeProxy'
  | 'clearCache'
  | 'audiobookDownloads'
  | 'ebookDownloads'
  | 'backupSecrets'

export function SettingsScreen() {
  const { t, i18n } = useLingui()
  const errorText = useErrorText()
  const router = useRouter()
  const { showFeedback } = useFeedback()
  const preferences = usePreferences()
  const speechModel = useSpeechModel()

  const speechProgress = i18n.number(
    speechModel.status === 'downloading' ? speechModel.progress : 0,
    { style: 'percent' },
  )

  const speechSize = dataSize(speechModelBytes, i18n.locale)

  const syncLabels = {
    off: t({ message: 'Off', comment: 'Listening and reading setting: not carried over' }),
    chapters: t({
      message: 'Simple',
      comment: 'Listening and reading setting: the place is estimated from the chapters',
    }),
    words: t({
      message: 'Advanced',
      comment: 'Listening and reading setting: the place is found by listening to the words',
    }),
  }

  /**
   * Keeps the speech model only while the mode that needs it is chosen: choosing it downloads the
   * model, and choosing another deletes it.
   */
  async function chooseReadingSync(mode: 'off' | 'chapters' | 'words') {
    await setPreference('readingSync', mode)

    if (mode !== 'words') {
      removeSpeechModel()

      return
    }

    if (speechModel.status === 'ready') {
      return
    }

    try {
      await installSpeechModel()
      showFeedback(
        t({ message: 'Speech model ready', comment: 'The speech model finished downloading' }),
      )
    } catch (error) {
      showFeedback(errorText(error instanceof Error ? error : null))
    }
  }

  const apiKey = useTorBoxKey()
  const hardcoverApiKey = useHardcoverKey()
  const abbProxy = useAbbProxy()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const restorer = useBackupRestore()
  // The removed proxy's address and username, offered again when replacing it.
  const [proxyDraft, setProxyDraft] = useState<Omit<AbbProxy, 'password'> | null>(null)

  const account = useTorBoxAccount()
  const annasCheck = useAnnasAccount()
  const annasSecret = useAnnasKey()
  const hardcoverCheck = useHardcoverAccount()
  const proxyCheck = useProxyCheck()

  // Local and cheap, so read afresh on every visit.
  const cacheSize = useQuery({
    queryKey: ['cached-data-size'],
    queryFn: async () => {
      const [metadata, audio] = await Promise.all([cachedMetadataSize(), audioCacheSize()])

      // E-books fetched only to read are cached too; kept ones are counted with the downloads.
      return metadata + audio + ebookCacheBytes()
    },
    staleTime: 0,
  })

  const offline = useOfflineBooks()
  const offlineCount = offline.size
  const offlineSize = dataSize(offlineBytes(offline), i18n.locale)
  const ebooks = useEbooks()
  const ebookCount = [...ebooks.values()].filter((ebook) => ebook.kept).length
  const ebookSize = dataSize(ebookBytes(ebooks), i18n.locale)

  /** Asks whether to include the keys when there are any, then saves the backup. */
  function backUp() {
    if (hasSecrets()) {
      setDialog('backupSecrets')
    } else {
      void saveBackup(false)
    }
  }

  async function saveBackup(withSecrets: boolean) {
    try {
      const name = await exportBackup(withSecrets)

      if (name) {
        showFeedback(t({ message: `Saved ${name}`, comment: 'Backup saved, with the file name' }))
      }
    } catch (error) {
      showFeedback(errorText(error instanceof Error ? error : null))
    }
  }

  const cachedSize = cacheSize.data === undefined ? null : dataSize(cacheSize.data, i18n.locale)

  const languageNames = useLanguageNames()

  const seconds = (value: number) =>
    t({ message: `${value} seconds`, comment: 'Skip interval option, for example “30 seconds”' })

  /** Resolves with a problem to show in the dialog, or null once the key is saved. */
  async function saveTorBoxKey(value: string) {
    try {
      const details = await connectTorBox(value)

      setDialog(null)
      showFeedback(
        details.email
          ? t({ message: `Connected to TorBox as ${details.email}`, comment: 'TorBox key saved' })
          : t({ message: 'Connected to TorBox', comment: 'TorBox key saved' }),
      )

      return null
    } catch (error) {
      return keyProblems.torBox(error instanceof Error ? error : new Error(String(error)))
    }
  }

  const keyProblems = useKeyProblems()
  const hardcoverProblem = keyProblems.hardcover

  /** Resolves with a problem to show in the dialog, or null once the key is saved. */
  async function saveHardcoverKey(value: string) {
    try {
      const account = await connectHardcover(value)

      setDialog(null)
      showFeedback(
        account?.email
          ? t({
              message: `Connected to Hardcover as ${account.email}`,
              comment: 'Hardcover key saved, with the account email',
            })
          : t({ message: 'Connected to Hardcover', comment: 'Hardcover key saved' }),
      )

      return null
    } catch (error) {
      return hardcoverProblem(error instanceof Error ? error : new Error(String(error)))
    }
  }

  const proxySetup = useProxySetup()
  const proxyProblem = proxySetup.problem

  /** Resolves with a problem to show in the dialog, or null once the proxy works and is saved. */
  async function saveProxy(values: ProxyFields) {
    const problem = await proxySetup.save(values)

    if (problem === null) {
      setDialog(null)
      showFeedback(
        t({
          message: 'AudioBookBay now goes through the proxy',
          comment: 'AudioBookBay proxy checked and saved',
        }),
      )
    }

    return problem
  }

  // Nothing under the row without a proxy, as the accounts show nothing before a key is added.
  const proxyValue = !abbProxy
    ? undefined
    : proxyCheck.isPending
      ? t({ message: 'Checking…', comment: 'AudioBookBay proxy row while testing the proxy' })
      : proxyCheck.error
        ? proxyProblem(proxyCheck.error)
        : `${abbProxy.host}:${abbProxy.port}`

  const torBoxValue = !apiKey
    ? undefined
    : account.isPending
      ? t({ message: 'Checking…', comment: 'TorBox row while verifying the key' })
      : account.error
        ? // Only a refusal of the key says so; being offline or TorBox failing says what happened.
          isAuthenticationError(account.error)
          ? t({
              message: 'The key was not accepted. Tap to replace it.',
              comment: 'TorBox row with a bad key',
            })
          : keyProblems.torBox(account.error)
        : (account.data?.email ??
          t({ message: 'Connected', comment: 'TorBox row with a valid key' }))

  const annasValue = !annasSecret
    ? undefined
    : annasCheck.isPending
      ? t({ message: 'Checking…', comment: 'Anna’s Archive row while verifying the key' })
      : annasCheck.error
        ? annasCheck.error instanceof AnnasKeyError
          ? t({
              message: 'The key was not accepted. Tap to replace it.',
              comment: 'Anna’s Archive row with a bad key',
            })
          : t({
              message: 'Anna’s Archive could not be reached. Check its address.',
              comment: 'Anna’s Archive row when the mirror does not answer',
            })
        : t({ message: 'Connected', comment: 'Anna’s Archive row with a valid key' })

  const hardcoverValue = !hardcoverApiKey
    ? undefined
    : hardcoverCheck.isPending
      ? t({ message: 'Checking…', comment: 'Hardcover row while verifying the key' })
      : hardcoverCheck.error
        ? hardcoverProblem(hardcoverCheck.error)
        : (hardcoverCheck.data?.email ??
          (hardcoverCheck.data?.username ? `@${hardcoverCheck.data.username}` : null) ??
          t({ message: 'Connected', comment: 'Hardcover row with a valid key' }))

  return (
    <Screen
      title={t({ message: 'Settings', comment: 'Title of the settings screen' })}
      appBar='large'
      navigation='back'
    >
      <List grouped>
        <Group
          title={t({ message: 'Accounts', comment: 'Settings section' })}
          rows={[
            {
              key: 'torbox',
              glyph: 'key',
              label: t({ message: 'TorBox', comment: 'Name of the streaming service' }),
              value: torBoxValue,
              onPress: () => setDialog(apiKey ? 'removeTorbox' : 'torbox'),
            },
            {
              key: 'hardcover',
              glyph: 'link',
              label: t({ message: 'Hardcover', comment: 'Name of the book metadata service' }),
              value: hardcoverValue,
              onPress: () => setDialog(hardcoverApiKey ? 'removeHardcover' : 'hardcover'),
            },
            {
              key: 'annas',
              glyph: 'annasArchive',
              label: t({ message: 'Anna’s Archive', comment: 'Name of the e-book library' }),
              value: annasValue,
              onPress: () => setDialog(annasSecret ? 'removeAnnas' : 'annas'),
            },
          ]}
        />
        <Group
          title={t({ message: 'Sources', comment: 'Settings section' })}
          rows={[
            {
              key: 'source',
              glyph: 'search',
              label: t({ message: 'AudioBookBay address', comment: 'Setting for the site mirror' }),
              value: preferences.abbBaseUrl,
              onPress: () => setDialog('source'),
            },
            {
              key: 'proxy',
              glyph: 'proxy',
              label: t({
                message: 'AudioBookBay proxy',
                comment: 'Setting for the proxy AudioBookBay pages are loaded through',
              }),
              value: proxyValue,
              onPress: () => setDialog(abbProxy ? 'removeProxy' : 'proxy'),
            },
            {
              key: 'annasAddress',
              glyph: 'annasArchive',
              label: t({
                message: 'Anna’s Archive address',
                comment: 'Setting for the e-book library mirror',
              }),
              value: preferences.annasBaseUrl,
              onPress: () => setDialog('annasAddress'),
            },
            {
              key: 'libgenAddress',
              glyph: 'libraryGenesis',
              label: t({
                message: 'Library Genesis address',
                comment: 'Setting for the e-book library mirror used without a member key',
              }),
              value: preferences.libgenBaseUrl,
              onPress: () => setDialog('libgenAddress'),
            },
            {
              key: 'preferredLanguage',
              glyph: 'language',
              label: t({
                message: 'Preferred language',
                comment:
                  'Setting for the language audiobooks and e-books are ranked first in, English next',
              }),
              value: languageNames[preferences.preferredLanguage],
              onPress: () => setDialog('preferredLanguage'),
            },
          ]}
        />
        <Group
          title={t({ message: 'Playback', comment: 'Settings section' })}
          rows={[
            {
              key: 'speed',
              glyph: 'speed',
              label: t({ message: 'Default speed', comment: 'Setting for new books' }),
              value: speedLabel(preferences.defaultSpeed),
              onPress: () => setDialog('speed'),
            },
            {
              key: 'skipBack',
              glyph: 'rewind',
              label: t({ message: 'Skip back', comment: 'Setting for the rewind button' }),
              value: seconds(preferences.skipBackSeconds),
              onPress: () => setDialog('skipBack'),
            },
            {
              key: 'skipForward',
              glyph: 'forward',
              label: t({ message: 'Skip forward', comment: 'Setting for the fast-forward button' }),
              value: seconds(preferences.skipForwardSeconds),
              onPress: () => setDialog('skipForward'),
            },
            {
              key: 'readingSync',
              glyph: 'readingSync',
              label: t({
                message: 'Listening and reading',
                comment: 'Setting for carrying the place between the audiobook and the e-book',
              }),
              value:
                preferences.readingSync === 'words' && speechModel.status === 'downloading'
                  ? t({
                      message: `Downloading speech model · ${speechProgress}`,
                      comment: 'Listening and reading setting while its speech model downloads',
                    })
                  : preferences.readingSync === 'words' && speechModel.status !== 'ready'
                    ? t({
                        message: 'Speech model missing. Choose again to download it.',
                        comment:
                          'Listening and reading setting when its speech model failed to download',
                      })
                    : syncLabels[preferences.readingSync],
              onPress: () => setDialog('readingSync'),
            },
          ]}
        />
        <Group
          title={t({ message: 'Storage', comment: 'Settings section' })}
          rows={[
            {
              key: 'clearCache',
              glyph: 'delete',
              label: t({
                message: 'Clear cached data',
                comment: 'Setting that clears cached book details and streamed audio',
              }),
              value: cachedSize
                ? t({
                    message: `${cachedSize} cached`,
                    comment: 'Size of the cached data, like “2.4 MB cached”',
                  })
                : undefined,
              onPress: () => setDialog('clearCache'),
            },
            {
              key: 'offline',
              glyph: 'listen',
              label: t({
                message: 'Audiobooks',
                comment: 'Storage setting showing the audiobooks downloaded to the phone',
              }),
              value:
                offlineCount === 0
                  ? t({
                      message: 'None',
                      context: 'downloads',
                      comment: 'Storage row when nothing of its kind is downloaded',
                    })
                  : t({
                      message: plural(offlineCount, {
                        one: `# audiobook · ${offlineSize}`,
                        other: `# audiobooks · ${offlineSize}`,
                      }),
                      comment: 'Audiobooks storage row, like “2 audiobooks · 640 MB”',
                    }),
              onPress: () => setDialog('audiobookDownloads'),
            },
            {
              key: 'ebooks',
              glyph: 'read',
              label: t({
                message: 'E-books',
                comment: 'Storage setting showing the e-books downloaded to the phone',
              }),
              value:
                ebookCount === 0
                  ? t({
                      message: 'None',
                      context: 'downloads',
                      comment: 'Storage row when nothing of its kind is downloaded',
                    })
                  : t({
                      message: plural(ebookCount, {
                        one: `# e-book · ${ebookSize}`,
                        other: `# e-books · ${ebookSize}`,
                      }),
                      comment: 'E-books storage row, like “3 e-books · 4.2 MB”',
                    }),
              onPress: () => setDialog('ebookDownloads'),
            },
          ]}
        />
        <Group
          title={t({ message: 'Backup', comment: 'Settings section' })}
          rows={[
            {
              key: 'export',
              glyph: 'backup',
              label: t({
                message: 'Back up library',
                comment: 'Settings row saving a backup file',
              }),
              onPress: backUp,
            },
            {
              key: 'restore',
              glyph: 'download',
              label: t({
                message: 'Restore from backup',
                comment: 'Settings row reading a backup file',
              }),
              onPress: () => void restorer.pick(),
            },
          ]}
        />
        <Group
          title={t({ message: 'About', comment: 'Settings section' })}
          rows={[
            {
              key: 'version',
              glyph: 'info',
              label: t({ message: 'Version', comment: 'App version label' }),
              value: `${Application.nativeApplicationVersion ?? '1.0.0'} (${Application.nativeBuildVersion ?? '1'})`,
            },
            {
              key: 'licenses',
              glyph: 'license',
              label: t({
                message: 'Licenses',
                comment: 'Settings row opening the licenses of the open-source packages',
              }),
              drillIn: true,
              onPress: () => router.push('/licenses'),
            },
          ]}
        />
      </List>
      {dialog === 'torbox' ? (
        <TextDialog
          title={t({ message: 'TorBox API key', comment: 'Dialog title' })}
          label={t({ message: 'API key', comment: 'Text field label' })}
          initialValue=''
          secret
          confirmLabel={t({ message: 'Save', comment: 'Saves a setting' })}
          onConfirm={saveTorBoxKey}
          onDismiss={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'removeTorbox' ? (
        <ConfirmDialog
          title={t({ message: 'Replace the TorBox key?', comment: 'Dialog title' })}
          message={t({
            message:
              'The current key is removed from this device. You can add a new one afterwards.',
            comment: 'Explains removing the TorBox key',
          })}
          confirmLabel={t({ message: 'Remove key', comment: 'Removes the stored TorBox key' })}
          onConfirm={() => {
            forgetStreamUrls()
            void torBoxKey.set(null).then(() => setDialog('torbox'))
          }}
          onDismiss={() => setDialog((current) => (current === 'removeTorbox' ? null : current))}
        />
      ) : null}
      {dialog === 'hardcover' ? (
        <TextDialog
          title={t({ message: 'Hardcover API key', comment: 'Dialog title' })}
          label={t({ message: 'API key', comment: 'Text field label' })}
          initialValue=''
          secret
          confirmLabel={t({ message: 'Save', comment: 'Saves a setting' })}
          onConfirm={saveHardcoverKey}
          onDismiss={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'removeHardcover' ? (
        <ConfirmDialog
          title={t({ message: 'Replace the Hardcover key?', comment: 'Dialog title' })}
          message={t({
            message:
              'The key is removed from this device. Details already saved for your books stay; new books use AudioBookBay details until you add a key.',
            comment: 'Explains removing the Hardcover key',
          })}
          confirmLabel={t({ message: 'Remove key', comment: 'Removes a stored API key' })}
          onConfirm={() => {
            void hardcoverKey.set(null).then(() => setDialog('hardcover'))
          }}
          onDismiss={() => setDialog((current) => (current === 'removeHardcover' ? null : current))}
        />
      ) : null}
      {dialog === 'preferredLanguage' ? (
        <ChoiceDialog
          title={t({ message: 'Preferred language', comment: 'Dialog title' })}
          // English, the default, first; the rest by name in the listener's language.
          options={Object.entries(languageNames)
            .map(([value, label]) => ({ value, label }))
            .sort(
              (a, b) =>
                Number(b.value === 'en') - Number(a.value === 'en') ||
                a.label.localeCompare(b.label, i18n.locale),
            )}
          selected={preferences.preferredLanguage}
          onSelect={(value) => {
            if (isLanguage(value)) {
              void setPreference('preferredLanguage', value)
            }
          }}
          onDismiss={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'speed' ? (
        <ChoiceDialog
          title={t({ message: 'Default speed', comment: 'Dialog title' })}
          options={playbackSpeeds.map((value) => ({ value, label: speedLabel(value) }))}
          selected={preferences.defaultSpeed}
          onSelect={(value) => void setPreference('defaultSpeed', value)}
          onDismiss={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'readingSync' ? (
        <ChoiceDialog
          title={t({ message: 'Listening and reading', comment: 'Dialog title' })}
          options={[
            {
              value: 'off' as const,
              label: syncLabels.off,
              description: t({
                message: 'Each keeps its own place.',
                comment: 'Listening and reading choice: no carrying over',
              }),
            },
            {
              value: 'chapters' as const,
              label: syncLabels.chapters,
              description: t({
                message: 'Picks up near the same spot in the chapter.',
                comment: 'Listening and reading choice: chapter estimate',
              }),
            },
            {
              value: 'words' as const,
              label: syncLabels.words,
              description: t({
                message: `Finds the exact sentence. Downloads ${speechSize} for English books.`,
                comment:
                  'Listening and reading choice: exact place by speech recognition, with the download size',
              }),
            },
          ]}
          selected={preferences.readingSync}
          onSelect={(mode) => void chooseReadingSync(mode)}
          onDismiss={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'skipBack' || dialog === 'skipForward' ? (
        <ChoiceDialog
          title={
            dialog === 'skipBack'
              ? t({ message: 'Skip back', comment: 'Dialog title' })
              : t({ message: 'Skip forward', comment: 'Dialog title' })
          }
          options={skipIntervals.map((value) => ({ value, label: seconds(value) }))}
          selected={
            dialog === 'skipBack' ? preferences.skipBackSeconds : preferences.skipForwardSeconds
          }
          onSelect={(value) =>
            void setPreference(
              dialog === 'skipBack' ? 'skipBackSeconds' : 'skipForwardSeconds',
              value,
            )
          }
          onDismiss={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'annas' ? (
        <TextDialog
          title={t({ message: 'Anna’s Archive key', comment: 'Dialog title' })}
          label={t({ message: 'Secret key', comment: 'Text field label' })}
          initialValue=''
          secret
          confirmLabel={t({ message: 'Save', comment: 'Saves a setting' })}
          onConfirm={async (value) => {
            try {
              await connectAnnas(value)
              setDialog(null)
              showFeedback(
                t({ message: 'Connected to Anna’s Archive', comment: 'Anna’s Archive key saved' }),
              )

              return null
            } catch (error) {
              return error instanceof AnnasKeyError
                ? t({
                    message: 'Anna’s Archive did not accept this key',
                    comment: 'Anna’s Archive key rejected',
                  })
                : t({
                    message: 'Anna’s Archive could not be reached. Check its address.',
                    comment: 'Anna’s Archive row when the mirror does not answer',
                  })
            }
          }}
          onDismiss={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'removeAnnas' ? (
        <ConfirmDialog
          title={t({ message: 'Replace the Anna’s Archive key?', comment: 'Dialog title' })}
          message={t({
            message:
              'The key is removed from this device. E-books come from Library Genesis until you add one.',
            comment: 'Explains removing the Anna’s Archive key',
          })}
          confirmLabel={t({ message: 'Remove key', comment: 'Removes a stored API key' })}
          onConfirm={() => {
            void annasKey.set(null).then(() => setDialog('annas'))
          }}
          onDismiss={() => setDialog((current) => (current === 'removeAnnas' ? null : current))}
        />
      ) : null}
      {dialog === 'annasAddress' || dialog === 'libgenAddress' ? (
        <TextDialog
          title={
            dialog === 'annasAddress'
              ? t({ message: 'Anna’s Archive address', comment: 'Dialog title' })
              : t({ message: 'Library Genesis address', comment: 'Dialog title' })
          }
          label={t({ message: 'Address', comment: 'Text field label' })}
          initialValue={
            dialog === 'annasAddress' ? preferences.annasBaseUrl : preferences.libgenBaseUrl
          }
          confirmLabel={t({ message: 'Save', comment: 'Saves a setting' })}
          onConfirm={async (value) => {
            try {
              await setPreference(
                dialog === 'annasAddress' ? 'annasBaseUrl' : 'libgenBaseUrl',
                normalizeBaseUrl(value),
              )
              setDialog(null)

              return null
            } catch {
              return t({ message: 'That is not a valid web address', comment: 'Invalid URL' })
            }
          }}
          onDismiss={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'source' ? (
        <TextDialog
          title={t({ message: 'AudioBookBay address', comment: 'Dialog title' })}
          label={t({ message: 'Address', comment: 'Text field label' })}
          initialValue={preferences.abbBaseUrl}
          confirmLabel={t({ message: 'Save', comment: 'Saves a setting' })}
          onConfirm={async (value) => {
            try {
              await setPreference('abbBaseUrl', normalizeBaseUrl(value))
              setDialog(null)

              return null
            } catch {
              return t({ message: 'That is not a valid web address', comment: 'Invalid URL' })
            }
          }}
          onDismiss={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'proxy' ? (
        <FormDialog
          title={t({ message: 'AudioBookBay proxy', comment: 'Dialog title' })}
          fields={[
            {
              key: 'host',
              label: t({
                message: 'Proxy address',
                comment: 'Text field label, like isp.decodo.com',
              }),
              initialValue: proxyDraft?.host ?? '',
            },
            {
              key: 'port',
              label: t({ message: 'Port', comment: 'Text field label for the proxy port' }),
              initialValue: proxyDraft ? String(proxyDraft.port) : '',
              numeric: true,
            },
            {
              key: 'username',
              label: t({ message: 'Username', comment: 'Text field label for the proxy username' }),
              initialValue: proxyDraft?.username ?? '',
            },
            {
              key: 'password',
              label: t({ message: 'Password', comment: 'Text field label for the proxy password' }),
              initialValue: '',
              secret: true,
            },
          ]}
          confirmLabel={t({ message: 'Save', comment: 'Saves a setting' })}
          onConfirm={saveProxy}
          onDismiss={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'removeProxy' && abbProxy ? (
        <ConfirmDialog
          title={t({ message: 'Replace the AudioBookBay proxy?', comment: 'Dialog title' })}
          message={t({
            message:
              'The proxy is removed from this device and pages load directly until you add one again.',
            comment: 'Explains removing the AudioBookBay proxy',
          })}
          confirmLabel={t({ message: 'Remove proxy', comment: 'Removes the stored proxy' })}
          onConfirm={() => {
            setProxyDraft({
              host: abbProxy.host,
              port: abbProxy.port,
              username: abbProxy.username,
            })
            void setAbbProxy(null).then(() => setDialog('proxy'))
          }}
          onDismiss={() => setDialog((current) => (current === 'removeProxy' ? null : current))}
        />
      ) : null}
      {dialog === 'backupSecrets' ? (
        <ConfirmDialog
          title={t({ message: 'Include keys and passwords?', comment: 'Dialog title' })}
          message={t({
            message: 'Anyone with the file can use them.',
            comment: 'Warns that a backup with API keys and the proxy password exposes them',
          })}
          confirmLabel={t({ message: 'Include', comment: 'Backs up with keys and passwords' })}
          dismissLabel={t({ message: 'Leave out', comment: 'Backs up without keys and passwords' })}
          onConfirm={() => void saveBackup(true)}
          onDecline={() => void saveBackup(false)}
          onDismiss={() => setDialog(null)}
        />
      ) : null}
      {restorer.dialog}
      {dialog === 'audiobookDownloads' ? (
        <AudiobookDownloadsSheet onDismiss={() => setDialog(null)} />
      ) : null}
      {dialog === 'ebookDownloads' ? (
        <EbookDownloadsSheet onDismiss={() => setDialog(null)} />
      ) : null}
      {dialog === 'clearCache' ? (
        <ConfirmDialog
          title={t({ message: 'Clear cached data?', comment: 'Dialog title' })}
          message={t({
            message: 'It downloads again when needed.',
            comment: 'Explains clearing cached book details and streamed audio',
          })}
          confirmLabel={t({ message: 'Clear', comment: 'Confirms clearing the cache' })}
          onConfirm={() => {
            Promise.all([clearCachedMetadata(), clearAudioCache(), clearEbookCache()])
              .then(() => {
                queryClient.clear()
                invalidateLibrary()
                showFeedback(t({ message: 'Cached data cleared', comment: 'Cache cleared' }))
              })
              .catch((error: Error) => showFeedback(errorText(error)))
          }}
          onDismiss={() => setDialog(null)}
        />
      ) : null}
    </Screen>
  )
}
