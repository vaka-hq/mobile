import { Box, Button, Column, Text, useMaterialColors } from '@expo/ui/jetpack-compose'
import { fillMaxSize, paddingAll } from '@expo/ui/jetpack-compose/modifiers'
import { useLingui } from '@lingui/react/macro'
import { Host } from '@/components/host'

export default function AppError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useLingui()
  const colors = useMaterialColors()

  return (
    <Host style={{ flex: 1 }}>
      <Box contentAlignment='center' modifiers={[fillMaxSize(), paddingAll(32)]}>
        <Column horizontalAlignment='center' verticalArrangement={{ spacedBy: 16 }}>
          <Text style={{ textAlign: 'center', typography: 'headlineSmall' }}>
            {t({ message: 'Something went wrong', comment: 'Title of the app-wide error screen' })}
          </Text>
          <Text
            color={colors.onSurfaceVariant}
            style={{ textAlign: 'center', typography: 'bodyLarge' }}
          >
            {t({ message: 'Please try again.', comment: 'Body of the app-wide error screen' })}
          </Text>
          <Button onClick={onRetry}>
            <Text>{t({ message: 'Try again', comment: 'Retries after an app-wide error' })}</Text>
          </Button>
          {__DEV__ ? (
            <Text
              color={colors.onSurfaceVariant}
              style={{ textAlign: 'center', typography: 'bodySmall' }}
            >
              {message}
            </Text>
          ) : null}
        </Column>
      </Box>
    </Host>
  )
}
