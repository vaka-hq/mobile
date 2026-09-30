export function appIdentity(value: string | undefined) {
  const variant = value ?? 'development'

  if (variant !== 'development' && variant !== 'preview' && variant !== 'production') {
    throw new Error(`Unknown APP_VARIANT: ${variant}`)
  }

  const suffix = variant === 'production' ? '' : variant === 'development' ? '.dev' : '.preview'

  return {
    variant,
    name:
      variant === 'production' ? 'Vaka' : variant === 'development' ? 'Vaka Dev' : 'Vaka Preview',
    androidPackage: `app.vaka.android${suffix}`,
    scheme:
      variant === 'production' ? 'vaka' : variant === 'development' ? 'vaka-dev' : 'vaka-preview',
  }
}
