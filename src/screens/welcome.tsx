import { useLingui } from '@lingui/react/macro'
import { useRouter } from 'expo-router'
import { type ReactNode, useEffect, useState } from 'react'
import { BackHandler } from 'react-native'
import { useBackupRestore } from '@/components/backup-restore'
import { type ProxyFields, useProxySetup } from '@/components/proxy-setup'
import { fillMaxSize, fillMaxWidth, imePadding, padding, weight } from '@/lib/compose-modifiers'
import {
  AnimatedVisibility,
  Box,
  Button,
  Column,
  EnterTransition,
  ExitTransition,
  Text,
  TextField,
  useNativeState,
} from '@/lib/compose-ui'
import { connectHardcover, connectTorBox } from '@/settings/account-checks'
import { useKeyProblems } from '@/settings/key-problems'
import { setPreference } from '@/settings/preferences'
import { torBoxKey } from '@/settings/torbox-key'
import type { Glyph } from '@/ui/glyphs'
import { IntroHeader, StepDots } from '@/ui/primitives'
import { Screen } from '@/ui/screen'

type Step = 'welcome' | 'torbox' | 'hardcover' | 'proxy'

const steps: Step[] = ['welcome', 'torbox', 'hardcover', 'proxy']

/** One text field of a setup step. */
type Field<K extends string> = {
  key: K
  label: string
  /** Hidden as it is typed, such as a key or a password. */
  secret?: boolean
  /** Typed on the number keyboard, such as a port. */
  numeric?: boolean
  /** Left empty, the step can still be sent. */
  optional?: boolean
}

/** A field that keeps its own text, reporting each change; the last one says how sending went. */
function SetupField({
  field,
  last,
  supporting,
  isError,
  onChange,
  onDone,
}: {
  field: Field<string>
  last: boolean
  supporting: string
  isError: boolean
  onChange: (value: string) => void
  onDone: () => void
}) {
  const text = useNativeState('')

  return (
    <TextField
      value={text}
      singleLine
      isError={isError}
      visualTransformation={field.secret ? 'password' : 'none'}
      keyboardOptions={{
        autoCorrectEnabled: false,
        capitalization: 'none',
        keyboardType: field.secret ? 'password' : field.numeric ? 'number' : 'uri',
        imeAction: last ? 'done' : 'next',
      }}
      keyboardActions={last ? { onDone } : undefined}
      onValueChange={onChange}
      modifiers={[fillMaxWidth()]}
    >
      <TextField.Label>
        <Text>{field.label}</Text>
      </TextField.Label>
      {last ? (
        <TextField.SupportingText>
          <Text>{supporting}</Text>
        </TextField.SupportingText>
      ) : null}
    </TextField>
  )
}

/** Space that takes an equal share of what is left, so what sits between two is centred. */
function Filler() {
  return <Column modifiers={[weight(1)]}>{null}</Column>
}

/**
 * A setup step: its icon and title with its fields, centred, and the button that checks what was
 * entered with the service before keeping it. Skipping lives in the app bar.
 */
function SetupStep<K extends string>({
  glyph,
  title,
  fields,
  submitLabel,
  submit,
  onDone,
}: {
  glyph: Glyph
  title: string
  fields: Field<K>[]
  submitLabel: string
  /** Checks and keeps the values; resolves with a problem to show, or null once they are kept. */
  submit: (values: Record<K, string>) => Promise<string | null>
  onDone: () => void
}) {
  const { t } = useLingui()
  const [values, setValues] = useState<Map<K, string>>(new Map())
  const [checking, setChecking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const valueOf = (key: K) => (values.get(key) ?? '').trim()
  const filled = fields.every((field) => field.optional || valueOf(field.key).length > 0)

  async function send() {
    if (!filled || checking) {
      return
    }

    setChecking(true)
    setProblem(null)

    const entered = new Map(fields.map((field) => [field.key, valueOf(field.key)]))
    const result = await submit(recordOf(fields, entered))

    setChecking(false)

    if (result === null) {
      onDone()
    } else {
      setProblem(result)
    }
  }

  return (
    <Column modifiers={[fillMaxSize()]}>
      <Column
        modifiers={[fillMaxWidth(), weight(1)]}
        horizontalAlignment='center'
        verticalArrangement={{ spacedBy: 24 }}
      >
        <Filler />
        <IntroHeader glyph={glyph} title={title} />
        <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 8 }}>
          {fields.map((field, index) => (
            <SetupField
              key={field.key}
              field={field}
              last={index === fields.length - 1}
              supporting={
                checking
                  ? t({ message: 'Checking…', comment: 'Shown while a value is being verified' })
                  : (problem ?? '')
              }
              isError={problem !== null}
              onChange={(next) => {
                setValues((current) => new Map(current).set(field.key, next))
                setProblem(null)
              }}
              onDone={() => void send()}
            />
          ))}
        </Column>
        <Filler />
      </Column>
      <Button
        onClick={() => void send()}
        enabled={filled && !checking}
        modifiers={[fillMaxWidth()]}
      >
        <Text>{submitLabel}</Text>
      </Button>
    </Column>
  )
}

/** How far a page slides as it comes in or goes, as a share of the screen's width. */
const pageSlide = 0.15

/**
 * One step's page, sliding in from the side the listener is heading to as the one before fades
 * off the other way, Material's shared axis along the steps; hidden pages keep what was typed.
 */
function StepPage({
  shown,
  forward,
  children,
}: {
  shown: boolean
  /** The listener is moving on rather than back. */
  forward: boolean
  children: ReactNode
}) {
  const from = forward ? pageSlide : -pageSlide

  return (
    <AnimatedVisibility
      visible={shown}
      enterTransition={EnterTransition.fadeIn().plus(
        EnterTransition.slideInHorizontally({ initialOffsetX: from }),
      )}
      exitTransition={ExitTransition.fadeOut().plus(
        ExitTransition.slideOutHorizontally({ targetOffsetX: -from }),
      )}
      modifiers={[fillMaxSize()]}
    >
      {children}
    </AnimatedVisibility>
  )
}

/** The fields' values by key, each field given one. */
function recordOf<K extends string>(fields: Field<K>[], entered: Map<K, string>) {
  // SAFETY: every field's key is set in the loop below, before the record is returned.
  const record = {} as Record<K, string>

  for (const field of fields) {
    record[field.key] = entered.get(field.key) ?? ''
  }

  return record
}

/**
 * The first start: what Vaka is, then the TorBox key it streams with, the Hardcover key that adds
 * book details, and a proxy for AudioBookBay for those whose connection it blocks. Each is checked
 * before it is kept, and each can be skipped from the app bar for Settings later. A backup can be
 * restored from the first page instead, such as on a new phone; one that brought the keys along
 * skips their steps.
 */
export function WelcomeScreen() {
  const { t } = useLingui()
  const router = useRouter()
  const problems = useKeyProblems()
  const proxy = useProxySetup()
  const [step, setShownStep] = useState(0)
  // Which way the pages slide: on to the next step, or back.
  const [forward, setForward] = useState(true)

  function setStep(to: number) {
    setForward(to >= step)
    setShownStep(to)
  }

  function finish() {
    void setPreference('onboarded', true)
    router.replace('/')
  }

  function next() {
    if (step >= steps.length - 1) {
      finish()
    } else {
      setStep(step + 1)
    }
  }

  const restorer = useBackupRestore(() => {
    if (torBoxKey.get()) {
      finish()
    } else {
      setStep(1)
    }
  })

  // Back returns to the step before rather than leaving the app mid-setup.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 0) {
        return false
      }

      setStep(step - 1)

      return true
    })

    return () => subscription.remove()
  }, [step])

  async function connect(key: string, service: 'torbox' | 'hardcover') {
    try {
      await (service === 'torbox' ? connectTorBox(key) : connectHardcover(key))

      return null
    } catch (error) {
      const problem = error instanceof Error ? error : new Error(String(error))

      return service === 'torbox' ? problems.torBox(problem) : problems.hardcover(problem)
    }
  }

  const connectLabel = t({ message: 'Connect', comment: 'Welcome step button checking an API key' })
  const current = steps[step] ?? 'welcome'

  return (
    <Screen
      title=''
      miniPlayer={false}
      centerTitle
      titleContent={<StepDots count={steps.length} current={step} />}
      leading={
        current === 'welcome' ? (
          <Button onClick={() => void restorer.pick()} modifiers={[padding(8, 0, 0, 0)]}>
            <Text>
              {t({
                message: 'Restore',
                comment: 'Welcome app bar button restoring a backup file instead of setting up',
              })}
            </Text>
          </Button>
        ) : null
      }
      actions={
        current === 'welcome' ? null : (
          <Button onClick={next} modifiers={[padding(0, 0, 8, 0)]}>
            <Text>{t({ message: 'Skip', comment: 'Welcome app bar button skipping a step' })}</Text>
          </Button>
        )
      }
    >
      <Box modifiers={[fillMaxSize(), imePadding(), padding(24, 16, 24, 16)]}>
        <StepPage shown={current === 'welcome'} forward={forward}>
          <Column modifiers={[fillMaxSize()]}>
            <Column
              modifiers={[fillMaxWidth(), weight(1)]}
              horizontalAlignment='center'
              verticalArrangement={{ spacedBy: 24 }}
            >
              <Filler />
              <IntroHeader
                glyph='listen'
                title={t({
                  message: 'Welcome to Vaka',
                  comment: 'Title of the first welcome screen',
                })}
                message={t({
                  message:
                    'Listen to audiobooks and read their e-books in one place. Next you connect TorBox to stream them, Hardcover for book details and, if you need one, a proxy for AudioBookBay.',
                  comment:
                    'What the app does and what the welcome steps set up; TorBox, Hardcover and AudioBookBay are names',
                })}
              />
              <Filler />
            </Column>
            <Button onClick={() => setStep(1)} modifiers={[fillMaxWidth()]}>
              <Text>{t({ message: 'Get started', comment: 'First welcome screen button' })}</Text>
            </Button>
          </Column>
        </StepPage>
        <StepPage shown={current === 'torbox'} forward={forward}>
          <SetupStep
            glyph='key'
            title={t({ message: 'Connect TorBox', comment: 'Welcome step title' })}
            fields={[
              {
                key: 'key',
                label: t({ message: 'API key', comment: 'Text field label' }),
                secret: true,
              },
            ]}
            submitLabel={connectLabel}
            submit={(values) => connect(values.key, 'torbox')}
            onDone={next}
          />
        </StepPage>
        <StepPage shown={current === 'hardcover'} forward={forward}>
          <SetupStep
            glyph='link'
            title={t({ message: 'Add Hardcover', comment: 'Welcome step title' })}
            fields={[
              {
                key: 'key',
                label: t({ message: 'API key', comment: 'Text field label' }),
                secret: true,
              },
            ]}
            submitLabel={connectLabel}
            submit={(values) => connect(values.key, 'hardcover')}
            onDone={next}
          />
        </StepPage>
        <StepPage shown={current === 'proxy'} forward={forward}>
          <SetupStep<keyof ProxyFields>
            glyph='proxy'
            title={t({
              message: 'AudioBookBay proxy',
              comment: 'Welcome step title for the optional proxy AudioBookBay pages go through',
            })}
            fields={[
              {
                key: 'host',
                label: t({ message: 'Address', comment: 'Text field label for the proxy host' }),
              },
              {
                key: 'port',
                label: t({ message: 'Port', comment: 'Text field label for the proxy port' }),
                numeric: true,
                optional: true,
              },
              {
                key: 'username',
                label: t({
                  message: 'Username',
                  comment: 'Text field label for the proxy username',
                }),
              },
              {
                key: 'password',
                label: t({
                  message: 'Password',
                  comment: 'Text field label for the proxy password',
                }),
                secret: true,
              },
            ]}
            submitLabel={connectLabel}
            submit={proxy.save}
            onDone={next}
          />
        </StepPage>
        {restorer.dialog}
      </Box>
    </Screen>
  )
}
