import { useLingui } from '@lingui/react/macro'
import { Host } from '@/components/host'
import { Empty } from '@/ui/primitives'

export default function AppError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useLingui()
  const body = t({ message: 'Please try again.', comment: 'Body of the app-wide error screen' })

  return (
    <Host style={{ flex: 1 }}>
      <Empty
        glyph='warning'
        height='fill'
        title={t({
          message: 'Something went wrong',
          comment: 'Title of the app-wide error screen',
        })}
        // In development, the error itself follows.
        message={__DEV__ ? `${body}\n\n${message}` : body}
        actionLabel={t({ message: 'Try again', comment: 'Retries after an app-wide error' })}
        onAction={onRetry}
      />
    </Host>
  )
}
