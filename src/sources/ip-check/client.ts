import { z } from 'zod'
import { HttpError, type TextReader } from '@/lib/http'

/** Decodo's address echo; it answers for any connection, proxied or not. */
const ipCheckUrl = 'https://ip.decodo.com/json'

const answerSchema = z.object({ proxy: z.object({ ip: z.string().min(1) }) })

/** Asks the echo service which address `reader`'s requests leave from. */
export async function checkExitAddress(reader: TextReader, signal?: AbortSignal) {
  const response = await reader(ipCheckUrl, { Accept: 'application/json' }, signal)

  if (response.status < 200 || response.status >= 300) {
    throw new HttpError(`The IP check answered ${response.status}`, response.status)
  }

  try {
    return answerSchema.parse(JSON.parse(response.body)).proxy.ip
  } catch {
    throw new HttpError('The IP check gave an unexpected answer', response.status)
  }
}
