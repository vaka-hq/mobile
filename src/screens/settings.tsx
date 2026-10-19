import { plural } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { useQuery } from '@tanstack/react-query'
import * as Application from 'expo-application'
import { getCalendars } from 'expo-localization'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useBackupRestore } from '@/components/backup-restore'
import { HardcoverKeyDialog } from '@/components/hardcover-key-dialog'
import { type ProxyFields, useProxySetup } from '@/components/proxy-setup'
import { AudiobookDownloadsSheet, EbookDownloadsSheet } from '@/components/storage-sheets'
import { useFeedback } from '@/lib/feedback'
import { queryClient } from '@/lib/query-client'
import {
  checkForUpdates,
  showUpdate,
  updatesSupported,
  useUpdateState,
} from '@/library/app-updates'
import { exportBackup, hasSecrets } from '@/library/backup'
import { ebookBytes, useEbooks } from '@/library/ebooks'
import { invalidateLibrary } from '@/library/invalidation'
import { isLanguage } from '@/library/languages'
import {
  chooseSyncSource,
  resyncLibrary,
  setLibrarySync,
  type SyncProblem,
  syncSources,
  useLibrarySync,
} from '@/library/library-sync'
import { offlineBytes, useOfflineBooks } from '@/library/offline'
import { cachedMetadataSize, clearCachedMetadata } from '@/library/repository'
import { installSpeechModel, removeSpeechModel, useSpeechModel } from '@/library/speech-model'
import { forgetStreamUrls } from '@/library/streams'
import { applySkipIntervals, audioCacheSize, clearAudioCache } from '@/player/controller'
import { type AbbProxy, setAbbProxy, useAbbProxy } from '@/settings/abb-proxy'
import {
  connectAnnas,
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
  getPreferences,
  playbackSpeeds,
  type SyncSourceId,
  setPreference,
  skipIntervals,
  syncSourceIds,
  usePreferences,
} from '@/settings/preferences'
import { torBoxKey, useTorBoxKey } from '@/settings/torbox-key'
import { AnnasKeyError } from '@/sources/annas-archive/client'
import { normalizeBaseUrl } from '@/sources/audiobookbay/client'
import { isAuthenticationError } from '@/sources/torbox/client'
import { ChoiceDialog, ConfirmDialog, FormDialog, TextDialog } from '@/ui/dialogs'
import { useErrorText } from '@/ui/errors'
import { dataSize, speedLabel, timeOfDay } from '@/ui/format'
import { useLanguageNames } from '@/ui/languages'
import { Group, List } from '@/ui/primitives'
import { Screen } from '@/ui/screen'

type Dialog =
  | 'torbox'
  | 'removeTorbox'
  | 'hardcover'
  | 'removeHardcover'
  | 'syncSource'
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
  | 'updateChannel'
  | 'backupSecrets'

export function SettingsScreen() {
  const { t, i18n } = useLingui()
  const errorText = useErrorText()
  const router = useRouter()
  const { showFeedback } = useFeedback()
  const preferences = usePreferences()
  const speechModel = useSpeechModel()
  const updateState = useUpdateState()
  const librarySync = useLibrarySync()
  // Saving a key asked for to turn sync on turns it on.
  const [syncAfterKey, setSyncAfterKey] = useState(false)

  const speechProgress = i18n.number(
    speechModel.status === 'downloading' ? speechModel.progress : 0,
    { style: 'percent' },
  )

  const syncLabels = {
    off: t({ message: 'Off', comment: 'Handoff setting: not carried over' }),
    chapters: t({
      message: 'Approximate',
      comment: 'Handoff setting: the place is estimated from its share of the chapter',
    }),
    words: t({
      message: 'Exact',
      comment: 'Handoff setting: the exact sentence is found by listening to the words',
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
      // Leaving the mode stops the download; that is no failure to tell.
      if (getPreferences().readingSync === 'words') {
        showFeedback(errorText(error instanceof Error ? error : null))
      }
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

      return metadata + audio
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

  const keyProblems = useKeyProblems()

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

  const proxySetup = useProxySetup()

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
        ? proxySetup.problem(proxyCheck.error)
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
        ? keyProblems.hardcover(hardcoverCheck.error)
        : (hardcoverCheck.data?.email ??
          (hardcoverCheck.data?.username ? `@${hardcoverCheck.data.username}` : null) ??
          t({ message: 'Connected', comment: 'Hardcover row with a valid key' }))

  const sourceNames = {
    hardcover: t({ message: 'Hardcover', comment: 'Name of the book metadata service' }),
  } satisfies Record<SyncSourceId, string>

  // No provider until the listener picks one; without one there is nothing to sync or say.
  const source = preferences.syncSource ? syncSources[preferences.syncSource] : null
  const sourceName = preferences.syncSource ? sourceNames[preferences.syncSource] : ''

  const syncedTime = librarySync.syncedAt
    ? timeOfDay(librarySync.syncedAt, i18n.locale, getCalendars()[0]?.uses24hourClock ?? null)
    : ''

  /** Why syncing keeps failing, said so the listener knows what to do about it. */
  function syncProblemText(problem: SyncProblem | null) {
    switch (problem) {
      case 'rejectedKey':
        return t({
          message: `${sourceName} didn’t accept your key. Replace it in Accounts.`,
          comment:
            'Library sync status when the provider rejects the API key as invalid or expired, with its name',
        })
      case 'missingAccess':
        return t({
          message: `Your ${sourceName} key can’t sync your library. Replace it with one that can.`,
          comment:
            'Library sync status when the API key lacks the permissions to read or change the library, with the provider name',
        })
      case 'limited':
        return t({
          message: `${sourceName}’s request limit was reached. It tries again later.`,
          comment: 'Library sync status when the provider’s rate limit is used up, with its name',
        })
      case null:
        return t({
          message: 'Couldn’t sync. It tries again soon.',
          comment: 'Library sync status after a sync failed for a passing reason',
        })
    }
  }

  // How syncing stands, in the row under the provider: while on, or when it cannot sync at all.
  const syncStatus = !source
    ? null
    : !source.ready()
      ? t({
          message: `Add your ${sourceName} API key to sync`,
          comment: 'Library sync status when the chosen provider has no key yet, with its name',
        })
      : !preferences.librarySync
        ? null
        : librarySync.syncing
          ? t({ message: 'Syncing…', comment: 'Library sync status while it syncs' })
          : librarySync.error
            ? syncProblemText(source.problem(librarySync.error))
            : librarySync.syncedAt
              ? t({
                  message: `Synced ${syncedTime}`,
                  comment: 'Library sync status with when it last synced, such as “Synced 14:05”',
                })
              : t({
                  message: 'Not synced yet',
                  comment: 'Library sync status before the first sync',
                })

  function toggleLibrarySync() {
    if (preferences.librarySync) {
      void setLibrarySync(false)
    } else if (source?.ready()) {
      void setLibrarySync(true)
    } else if (preferences.syncSource === 'hardcover') {
      setSyncAfterKey(true)
      setDialog('hardcover')
    }
  }

  function resync() {
    showFeedback(
      t({
        message: `Syncing everything again from ${sourceName}`,
        comment: 'Shown after holding the library sync row, with the source name',
      }),
    )
    void resyncLibrary()
  }

  const channelLabels = {
    stable: t({ message: 'Stable', comment: 'Update channel: tested releases only' }),
    nightly: t({
      message: 'Nightly',
      comment: 'Update channel: a build of the newest changes each day',
    }),
  }

  const updateValue =
    updateState.phase === 'checking'
      ? t({ message: 'Checking…', comment: 'Check for updates row while looking' })
      : updateState.phase === 'current'
        ? t({
            message: 'Up to date',
            comment: 'Check for updates row when no newer version exists',
          })
        : updateState.phase === 'available'
          ? t({
              message: `Vaka ${updateState.update.versionName} is available`,
              comment: 'Check for updates row with a newer version found, with its version name',
            })
          : updateState.phase === 'downloading'
            ? t({
                message: `Downloading… ${i18n.number(updateState.progress, { style: 'percent' })}`,
                comment: 'Check for updates row while the update downloads, with the share done',
              })
            : updateState.phase === 'installing'
              ? t({ message: 'Installing…', comment: 'Check for updates row while installing' })
              : updateState.phase === 'failed'
                ? updateState.update
                  ? t({
                      message: 'The update failed. Tap to try again.',
                      comment: 'Check for updates row after an update failed',
                    })
                  : t({
                      message: 'Couldn’t check for updates',
                      comment: 'Check for updates row when the releases could not be read',
                    })
                : undefined

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
          title={t({ message: 'Library', comment: 'Settings section' })}
          rows={[
            {
              key: 'syncSource',
              glyph: 'library',
              label: t({
                message: 'Provider',
                comment:
                  'Setting for which service the library is kept in step with, such as Hardcover',
              }),
              value:
                sourceName ||
                t({ message: 'None', comment: 'Library provider when no service is chosen' }),
              onPress: () => setDialog('syncSource'),
              // The switch turns syncing with the provider on and off; with none, it has none.
              toggle: preferences.librarySync,
              toggleHidden: !source,
              onToggle: toggleLibrarySync,
            },
            ...(syncStatus
              ? [
                  {
                    key: 'syncStatus',
                    glyph: 'shelfSync' as const,
                    label: syncStatus,
                    // Held while on, it syncs everything again from the provider.
                    onLongPress: preferences.librarySync && source?.ready() ? resync : undefined,
                  },
                ]
              : []),
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
                message: 'Handoff',
                comment:
                  'Setting for handing the place over between the audiobook and the e-book of the same book, when switching from one to the other',
              }),
              value:
                preferences.readingSync === 'words' && speechModel.status === 'downloading'
                  ? t({
                      message: `Downloading speech model · ${speechProgress}`,
                      comment: 'Handoff setting while its speech model downloads',
                    })
                  : preferences.readingSync === 'words' && speechModel.status !== 'ready'
                    ? t({
                        message: 'Speech model missing. Choose again to download it.',
                        comment: 'Handoff setting when its speech model failed to download',
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
        {updatesSupported ? (
          <Group
            title={t({ message: 'Updates', comment: 'Settings section' })}
            rows={[
              {
                key: 'updateChannel',
                glyph: 'updateChannel',
                label: t({
                  message: 'Update channel',
                  comment: 'Settings row choosing which releases the app updates to',
                }),
                value: channelLabels[preferences.updateChannel],
                onPress: () => setDialog('updateChannel'),
              },
              {
                key: 'checkUpdates',
                glyph: 'update',
                label: t({
                  message: 'Check for updates',
                  comment: 'Settings row looking for a newer version of the app',
                }),
                value: updateValue,
                onPress: () =>
                  updateState.phase === 'idle' ||
                  updateState.phase === 'current' ||
                  (updateState.phase === 'failed' && updateState.update === null)
                    ? void checkForUpdates({ asked: true })
                    : showUpdate(),
              },
            ]}
          />
        ) : null}
        <Group
          title={t({ message: 'About', comment: 'Settings section' })}
          rows={[
            {
              key: 'version',
              glyph: 'info',
              label: t({ message: 'Version', comment: 'App version label' }),
              value: Application.nativeApplicationVersion ?? '0.0.1',
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
        <HardcoverKeyDialog
          onClose={() => {
            setDialog(null)

            if (syncAfterKey && hardcoverKey.get()) {
              void setLibrarySync(true)
            }

            setSyncAfterKey(false)
          }}
        />
      ) : null}
      {dialog === 'syncSource' ? (
        <ChoiceDialog
          title={t({
            message: 'Provider',
            comment: 'Dialog title: which service the library is kept in step with',
          })}
          options={[
            {
              value: 'none' as const,
              label: t({ message: 'None', comment: 'Library provider when no service is chosen' }),
            },
            ...syncSourceIds.map((id) => ({ value: id, label: sourceNames[id] })),
          ]}
          selected={preferences.syncSource ?? 'none'}
          onSelect={(id) => void chooseSyncSource(id === 'none' ? null : id)}
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
      {dialog === 'updateChannel' ? (
        <ChoiceDialog
          title={t({ message: 'Update channel', comment: 'Dialog title' })}
          options={[
            { value: 'stable' as const, label: channelLabels.stable },
            { value: 'nightly' as const, label: channelLabels.nightly },
          ]}
          selected={preferences.updateChannel}
          onSelect={(channel) => {
            // A different channel may have a different newest build, so it is looked for at once.
            void setPreference('updateChannel', channel).then(() =>
              checkForUpdates({ asked: false }),
            )
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
          title={t({
            message: 'Handoff',
            comment:
              'Dialog title: how the place is handed over between the audiobook and the e-book of the same book',
          })}
          options={[
            { value: 'off' as const, label: syncLabels.off },
            { value: 'chapters' as const, label: syncLabels.chapters },
            { value: 'words' as const, label: syncLabels.words },
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
          // The notification's buttons jump the new distance at once, not from the next file.
          onSelect={(value) =>
            void setPreference(
              dialog === 'skipBack' ? 'skipBackSeconds' : 'skipForwardSeconds',
              value,
            ).then(applySkipIntervals)
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
            Promise.all([clearCachedMetadata(), clearAudioCache()])
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
