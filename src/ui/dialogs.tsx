import { useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import {
  clickable,
  clip,
  composeGeometry,
  fillMaxWidth,
  selectable,
  size,
  verticalScroll,
} from '@/lib/compose-modifiers'
import {
  AlertDialog,
  Box,
  Column,
  Icon,
  ListItem,
  LoadingIndicator,
  Row,
  RadioButton,
  Text,
  TextButton,
  TextField,
  useMaterialColors,
  useNativeState,
} from '@/lib/compose-ui'
import { useErrorText } from './errors'
import { type Glyph, glyphs } from './glyphs'

export type ChoiceDialogProps<T extends string | number> = {
  title: string
  /** Each choice, with a line under it when it needs explaining. */
  options: { value: T; label: string; description?: string }[]
  selected: T
  onSelect: (value: T) => void
  onDismiss: () => void
}

/** A single choice from a short list, applied as soon as it is tapped. */
export function ChoiceDialog<T extends string | number>({
  title,
  options,
  selected,
  onSelect,
  onDismiss,
}: ChoiceDialogProps<T>) {
  const { t } = useLingui()
  const colors = useMaterialColors()

  return (
    <AlertDialog onDismissRequest={onDismiss}>
      <AlertDialog.Title>
        <Text style={{ typography: 'headlineSmall' }}>{title}</Text>
      </AlertDialog.Title>
      <AlertDialog.Text>
        {/*
          Each choice is a rounded card, its ripple kept inside it, as in the dialog asking where
          to pick a book up. A long list, such as of languages, scrolls within the dialog.
        */}
        <Column
          modifiers={[fillMaxWidth(), verticalScroll()]}
          verticalArrangement={{ spacedBy: 8 }}
        >
          {options.map((option) => (
            <ListItem
              key={String(option.value)}
              colors={{ containerColor: colors.surfaceContainerHigh }}
              modifiers={[
                fillMaxWidth(),
                clip(composeGeometry.RoundedCorner(16)),
                selectable(option.value === selected, () => {
                  onSelect(option.value)
                  onDismiss()
                }),
              ]}
            >
              <ListItem.LeadingContent>
                <RadioButton selected={option.value === selected} />
              </ListItem.LeadingContent>
              <ListItem.HeadlineContent>
                {/* The line under a choice sits in the headline: a supporting slot keeps the
                    dialog from showing at all. */}
                <Column>
                  <Text>{option.label}</Text>
                  {option.description ? (
                    <Text color={colors.onSurfaceVariant} style={{ typography: 'bodyMedium' }}>
                      {option.description}
                    </Text>
                  ) : null}
                </Column>
              </ListItem.HeadlineContent>
            </ListItem>
          ))}
        </Column>
      </AlertDialog.Text>
      <AlertDialog.DismissButton>
        <TextButton onClick={onDismiss}>
          <Text>{t({ message: 'Cancel', comment: 'Closes a dialog without changes' })}</Text>
        </TextButton>
      </AlertDialog.DismissButton>
    </AlertDialog>
  )
}

export type TextDialogProps = {
  title: string
  message?: string
  label: string
  initialValue: string
  secret?: boolean
  /** Free text over several lines, such as a note, rather than a key or an address. */
  multiline?: boolean
  confirmLabel: string
  /**
   * Validates and saves the value. Resolves with a problem to show under the field, keeping the
   * dialog open, or with null once saved; the caller then closes the dialog.
   */
  onConfirm: (value: string) => Promise<string | null>
  onDismiss: () => void
}

/** Asks for one value, such as an API key or a web address, and stays open until it is accepted. */
export function TextDialog({
  title,
  message,
  label,
  initialValue,
  secret = false,
  multiline = false,
  confirmLabel,
  onConfirm,
  onDismiss,
}: TextDialogProps) {
  const { t } = useLingui()
  const errorText = useErrorText()
  const text = useNativeState(initialValue)
  const [value, setValue] = useState(initialValue)
  const [checking, setChecking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function submit(next: string) {
    const trimmed = next.trim()

    if (!trimmed || checking) {
      return
    }

    setChecking(true)
    setProblem(null)

    let result: string | null

    try {
      result = await onConfirm(trimmed)
    } catch (error) {
      // A save that throws rather than naming its problem still frees the dialog.
      result = errorText(error instanceof Error ? error : null)
    }

    // On success the caller unmounts the dialog, so state is only updated for a problem.
    if (result !== null) {
      setProblem(result)
      setChecking(false)
    }
  }

  return (
    // A save in flight finishes before the dialog can close, so a late answer never applies unseen.
    <AlertDialog onDismissRequest={checking ? undefined : onDismiss}>
      <AlertDialog.Title>
        <Text style={{ typography: 'headlineSmall' }}>{title}</Text>
      </AlertDialog.Title>
      <AlertDialog.Text>
        <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 16 }}>
          {message ? <Text style={{ typography: 'bodyMedium' }}>{message}</Text> : null}
          <TextField
            value={text}
            singleLine={!multiline}
            minLines={multiline ? 3 : 1}
            maxLines={multiline ? 8 : 1}
            autoFocus
            isError={problem !== null}
            visualTransformation={secret ? 'password' : 'none'}
            keyboardOptions={
              multiline
                ? { autoCorrectEnabled: true, capitalization: 'sentences', keyboardType: 'text' }
                : {
                    autoCorrectEnabled: false,
                    capitalization: 'none',
                    keyboardType: secret ? 'password' : 'uri',
                    imeAction: 'done',
                  }
            }
            keyboardActions={{ onDone: (next) => void submit(next) }}
            onValueChange={(next) => {
              setValue(next)
              setProblem(null)
            }}
            modifiers={[fillMaxWidth()]}
          >
            <TextField.Label>
              <Text>{label}</Text>
            </TextField.Label>
            <TextField.SupportingText>
              <Text>
                {checking
                  ? t({ message: 'Checking…', comment: 'Shown while a value is being verified' })
                  : (problem ?? '')}
              </Text>
            </TextField.SupportingText>
          </TextField>
        </Column>
      </AlertDialog.Text>
      <AlertDialog.ConfirmButton>
        <TextButton
          enabled={value.trim().length > 0 && !checking}
          onClick={() => void submit(value)}
        >
          <Text>{confirmLabel}</Text>
        </TextButton>
      </AlertDialog.ConfirmButton>
      <AlertDialog.DismissButton>
        <TextButton enabled={!checking} onClick={onDismiss}>
          <Text>{t({ message: 'Cancel', comment: 'Closes a dialog without changes' })}</Text>
        </TextButton>
      </AlertDialog.DismissButton>
    </AlertDialog>
  )
}

export type FormField<K extends string> = {
  key: K
  label: string
  initialValue: string
  secret?: boolean
  /** Typed on the number keyboard, such as a port. */
  numeric?: boolean
}

export type FormDialogProps<K extends string> = {
  title: string
  message?: string
  fields: FormField<K>[]
  confirmLabel: string
  /**
   * Validates and saves the trimmed values. Resolves with a problem to show under the last field,
   * keeping the dialog open, or with null once saved; the caller then closes the dialog.
   */
  onConfirm: (values: Record<K, string>) => Promise<string | null>
  onDismiss: () => void
}

type FormTextFieldProps = {
  label: string
  initialValue: string
  secret: boolean
  numeric: boolean
  first: boolean
  last: boolean
  supportingText: string | null
  isError: boolean
  onChange: (value: string) => void
  onDone: () => void
}

/** One field of a form; each owns its native text state. */
function FormTextField({
  label,
  initialValue,
  secret,
  numeric,
  first,
  last,
  supportingText,
  isError,
  onChange,
  onDone,
}: FormTextFieldProps) {
  const text = useNativeState(initialValue)

  return (
    <TextField
      value={text}
      singleLine
      autoFocus={first}
      isError={isError}
      visualTransformation={secret ? 'password' : 'none'}
      keyboardOptions={{
        autoCorrectEnabled: false,
        capitalization: 'none',
        keyboardType: secret ? 'password' : numeric ? 'number' : 'uri',
        imeAction: last ? 'done' : 'next',
      }}
      keyboardActions={last ? { onDone } : undefined}
      onValueChange={onChange}
      modifiers={[fillMaxWidth()]}
    >
      <TextField.Label>
        <Text>{label}</Text>
      </TextField.Label>
      {last ? (
        <TextField.SupportingText>
          <Text>{supportingText ?? ''}</Text>
        </TextField.SupportingText>
      ) : null}
    </TextField>
  )
}

/** Asks for several values that are checked together, such as a proxy and its sign-in. */
export function FormDialog<K extends string>({
  title,
  message,
  fields,
  confirmLabel,
  onConfirm,
  onDismiss,
}: FormDialogProps<K>) {
  const { t } = useLingui()
  const errorText = useErrorText()

  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.initialValue])),
  )

  const [checking, setChecking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const trimmed = Object.fromEntries(
    fields.map((field) => [field.key, (values[field.key] ?? '').trim()]),
  )

  // SAFETY: the entries above are built from exactly the keys in `fields`.
  const complete = trimmed as Record<K, string>
  const filled = fields.every((field) => complete[field.key].length > 0)

  async function submit() {
    if (!filled || checking) {
      return
    }

    setChecking(true)
    setProblem(null)

    let result: string | null

    try {
      result = await onConfirm(complete)
    } catch (error) {
      // A save that throws rather than naming its problem still frees the dialog.
      result = errorText(error instanceof Error ? error : null)
    }

    // On success the caller unmounts the dialog, so state is only updated for a problem.
    if (result !== null) {
      setProblem(result)
      setChecking(false)
    }
  }

  return (
    // A save in flight finishes before the dialog can close, so a late answer never applies unseen.
    <AlertDialog onDismissRequest={checking ? undefined : onDismiss}>
      <AlertDialog.Title>
        <Text style={{ typography: 'headlineSmall' }}>{title}</Text>
      </AlertDialog.Title>
      <AlertDialog.Text>
        <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 16 }}>
          {message ? <Text style={{ typography: 'bodyMedium' }}>{message}</Text> : null}
          {fields.map((field, index) => (
            <FormTextField
              key={field.key}
              label={field.label}
              initialValue={field.initialValue}
              secret={field.secret ?? false}
              numeric={field.numeric ?? false}
              first={index === 0}
              last={index === fields.length - 1}
              supportingText={
                checking
                  ? t({ message: 'Checking…', comment: 'Shown while a value is being verified' })
                  : problem
              }
              isError={problem !== null}
              onChange={(next) => {
                setValues((current) => ({ ...current, [field.key]: next }))
                setProblem(null)
              }}
              onDone={() => void submit()}
            />
          ))}
        </Column>
      </AlertDialog.Text>
      <AlertDialog.ConfirmButton>
        <TextButton enabled={filled && !checking} onClick={() => void submit()}>
          <Text>{confirmLabel}</Text>
        </TextButton>
      </AlertDialog.ConfirmButton>
      <AlertDialog.DismissButton>
        <TextButton enabled={!checking} onClick={onDismiss}>
          <Text>{t({ message: 'Cancel', comment: 'Closes a dialog without changes' })}</Text>
        </TextButton>
      </AlertDialog.DismissButton>
    </AlertDialog>
  )
}

/** One place a book can be picked up from, such as where it was last read. */
export type PlaceOption = {
  glyph: Glyph
  label: string
  /** Where that is, such as the chapter. */
  detail?: string | null
  onPress: () => void
}

/**
 * Asks where to pick a book up, as two plain choices, each saying where it leads. While the
 * chosen place is found it says so instead; Cancel stops that at any time.
 */
export function PlaceChoiceDialog({
  title,
  options,
  busy,
  onDismiss,
}: {
  title: string
  options: PlaceOption[]
  busy?: string | null
  onDismiss: () => void
}) {
  const { t } = useLingui()
  const colors = useMaterialColors()

  return (
    <AlertDialog onDismissRequest={onDismiss}>
      <AlertDialog.Title>
        <Text style={{ typography: 'headlineSmall' }}>{title}</Text>
      </AlertDialog.Title>
      <AlertDialog.Text>
        {busy ? (
          <Row verticalAlignment='center' horizontalArrangement={{ spacedBy: 16 }}>
            <LoadingIndicator modifiers={[size(32, 32)]} />
            <Text color={colors.onSurfaceVariant}>{busy}</Text>
          </Row>
        ) : (
          <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 8 }}>
            {options.map((option) => (
              <ListItem
                key={option.label}
                colors={{ containerColor: colors.surfaceContainerHigh }}
                modifiers={[
                  fillMaxWidth(),
                  clip(composeGeometry.RoundedCorner(16)),
                  clickable(option.onPress),
                ]}
              >
                <ListItem.LeadingContent>
                  <Icon source={glyphs[option.glyph]} size={24} tint={colors.primary} />
                </ListItem.LeadingContent>
                {/* The detail sits in the headline: a supporting slot keeps a dialog from showing. */}
                <ListItem.HeadlineContent>
                  <Column>
                    <Text>{option.label}</Text>
                    {/* The whole chapter name, however long, so the choice is clear. */}
                    {option.detail ? (
                      <Text color={colors.onSurfaceVariant} style={{ typography: 'bodyMedium' }}>
                        {option.detail}
                      </Text>
                    ) : null}
                  </Column>
                </ListItem.HeadlineContent>
              </ListItem>
            ))}
          </Column>
        )}
      </AlertDialog.Text>
      <AlertDialog.DismissButton>
        <TextButton onClick={onDismiss}>
          <Text>{t({ message: 'Cancel', comment: 'Closes a dialog without changes' })}</Text>
        </TextButton>
      </AlertDialog.DismissButton>
    </AlertDialog>
  )
}

/**
 * Says a place is being found, such as when switching from the player to the reader, over the
 * screen switched from; Cancel stops it at any time.
 */
export function FindingPlaceDialog({
  title,
  message,
  onCancel,
}: {
  title: string
  message: string
  onCancel: () => void
}) {
  const { t } = useLingui()
  const colors = useMaterialColors()

  return (
    <AlertDialog onDismissRequest={onCancel}>
      <AlertDialog.Title>
        <Text style={{ typography: 'headlineSmall' }}>{title}</Text>
      </AlertDialog.Title>
      <AlertDialog.Text>
        <Row verticalAlignment='center' horizontalArrangement={{ spacedBy: 16 }}>
          <LoadingIndicator modifiers={[size(32, 32)]} />
          <Text color={colors.onSurfaceVariant}>{message}</Text>
        </Row>
      </AlertDialog.Text>
      <AlertDialog.DismissButton>
        <TextButton onClick={onCancel}>
          <Text>{t({ message: 'Cancel', comment: 'Closes a dialog without changes' })}</Text>
        </TextButton>
      </AlertDialog.DismissButton>
    </AlertDialog>
  )
}

/**
 * Checks that a source can still be had before it is chosen: first a spinner while it is looked
 * up, with Cancel; then, should it seem unavailable, the same dialog asks whether to go ahead. The
 * confirm button's slot stays mounted throughout, since the dialog reads its slots only once.
 */
export function AvailabilityDialog({
  phase,
  checkingTitle,
  checkingMessage,
  deadTitle,
  deadMessage,
  continueLabel,
  onContinue,
  onCancel,
}: {
  phase: 'checking' | 'dead'
  checkingTitle: string
  checkingMessage: string
  deadTitle: string
  deadMessage: string
  continueLabel: string
  onContinue: () => void
  onCancel: () => void
}) {
  const { t } = useLingui()
  const colors = useMaterialColors()

  return (
    <AlertDialog onDismissRequest={onCancel}>
      <AlertDialog.Title>
        <Text style={{ typography: 'headlineSmall' }}>
          {phase === 'checking' ? checkingTitle : deadTitle}
        </Text>
      </AlertDialog.Title>
      <AlertDialog.Text>
        {phase === 'checking' ? (
          <Row verticalAlignment='center' horizontalArrangement={{ spacedBy: 16 }}>
            <LoadingIndicator modifiers={[size(32, 32)]} />
            <Text color={colors.onSurfaceVariant}>{checkingMessage}</Text>
          </Row>
        ) : (
          <Text>{deadMessage}</Text>
        )}
      </AlertDialog.Text>
      <AlertDialog.ConfirmButton>
        {phase === 'dead' ? (
          <TextButton onClick={onContinue}>
            <Text>{continueLabel}</Text>
          </TextButton>
        ) : (
          <Box />
        )}
      </AlertDialog.ConfirmButton>
      <AlertDialog.DismissButton>
        <TextButton onClick={onCancel}>
          <Text>{t({ message: 'Cancel', comment: 'Closes a dialog without changes' })}</Text>
        </TextButton>
      </AlertDialog.DismissButton>
    </AlertDialog>
  )
}

export type ConfirmDialogProps = {
  title: string
  message: string
  confirmLabel: string
  /** The button that closes the dialog without acting; Cancel unless said otherwise. */
  dismissLabel?: string
  onConfirm: () => void
  /**
   * Runs when that button is pressed, for a choice between two answers where closing the dialog
   * any other way, such as tapping outside it, answers neither.
   */
  onDecline?: () => void
  onDismiss: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  dismissLabel,
  onConfirm,
  onDecline,
  onDismiss,
}: ConfirmDialogProps) {
  const { t } = useLingui()

  return (
    <AlertDialog onDismissRequest={onDismiss}>
      <AlertDialog.Title>
        <Text style={{ typography: 'headlineSmall' }}>{title}</Text>
      </AlertDialog.Title>
      <AlertDialog.Text>
        <Text>{message}</Text>
      </AlertDialog.Text>
      <AlertDialog.ConfirmButton>
        <TextButton
          onClick={() => {
            onConfirm()
            onDismiss()
          }}
        >
          <Text>{confirmLabel}</Text>
        </TextButton>
      </AlertDialog.ConfirmButton>
      <AlertDialog.DismissButton>
        <TextButton
          onClick={() => {
            onDecline?.()
            onDismiss()
          }}
        >
          <Text>
            {dismissLabel ?? t({ message: 'Cancel', comment: 'Closes a dialog without changes' })}
          </Text>
        </TextButton>
      </AlertDialog.DismissButton>
    </AlertDialog>
  )
}
