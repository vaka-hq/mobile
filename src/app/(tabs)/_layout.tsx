import { TabList, TabSlot, Tabs, TabTrigger } from 'expo-router/ui'
import { View } from 'react-native'
import { BottomBar } from '@/components/bottom-bar'
import { miniPlayerHeight, setTabBarHeight } from '@/player/expansion'
import { usePlayerValue } from '@/player/use-player'

export default function TabsLayout() {
  const loaded = usePlayerValue((state) => state.book !== null)

  return (
    <Tabs options={{ backBehavior: 'history' }}>
      <View style={{ flex: 1 }}>
        <TabSlot style={{ flex: 1 }} />
        {/* Room for the mini player, which floats above the tab bar in the player layer. */}
        {loaded ? <View style={{ height: miniPlayerHeight }} /> : null}
        <View onLayout={(event) => setTabBarHeight(event.nativeEvent.layout.height)}>
          <BottomBar />
        </View>
      </View>
      <TabList style={{ display: 'none' }}>
        <TabTrigger name='library' href='/' />
        <TabTrigger name='browse' href='/browse' />
      </TabList>
    </Tabs>
  )
}
