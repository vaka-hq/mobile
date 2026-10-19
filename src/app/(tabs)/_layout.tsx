import { TabList, TabSlot, Tabs, TabTrigger } from 'expo-router/ui'
import { View } from 'react-native'
import { miniPlayerHeight, usePlayerLayout } from '@/player/expansion'
import { usePlayerValue } from '@/player/use-player'

export default function TabsLayout() {
  const loaded = usePlayerValue((state) => state.book !== null)
  const { tabBarHeight } = usePlayerLayout()

  return (
    <Tabs options={{ backBehavior: 'history' }}>
      <View style={{ flex: 1 }}>
        <TabSlot style={{ flex: 1 }} />
        {/* Room for the mini player and the tab bar, which float above the stack. */}
        {loaded ? <View style={{ height: miniPlayerHeight }} /> : null}
        <View style={{ height: tabBarHeight }} />
      </View>
      <TabList style={{ display: 'none' }}>
        <TabTrigger name='library' href='/' />
        <TabTrigger name='browse' href='/browse' />
      </TabList>
    </Tabs>
  )
}
