import { Redirect } from 'expo-router'
import { LibraryScreen } from '@/screens/library'
import { usePreferences } from '@/settings/preferences'
import { useTorBoxKey } from '@/settings/torbox-key'

/** The library, or the welcome screens on a first start that has no TorBox key yet. */
export default function LibraryRoute() {
  const { onboarded } = usePreferences()
  const torBoxKey = useTorBoxKey()

  return !onboarded && !torBoxKey ? <Redirect href='/welcome' /> : <LibraryScreen />
}
