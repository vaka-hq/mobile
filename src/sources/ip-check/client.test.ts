import { describe, expect, it } from 'vitest'
import type { TextReader } from '@/lib/http'
import { checkExitAddress } from './client'

function answering(status: number, body: string): TextReader {
  return async () => ({ status, body })
}

describe('IP check', () => {
  it('reads the exit address', async () => {
    const body = JSON.stringify({
      isp: { asn: 1257, isp: 'Tele2' },
      city: { name: 'Stockholm' },
      proxy: { ip: '192.0.2.10' },
      country: { name: 'Sweden', code: 'SE' },
    })

    await expect(checkExitAddress(answering(200, body))).resolves.toBe('192.0.2.10')
  })

  it('fails on an error status or an unexpected answer', async () => {
    await expect(checkExitAddress(answering(502, ''))).rejects.toThrow('answered 502')
    await expect(checkExitAddress(answering(200, '<html>'))).rejects.toThrow('unexpected answer')
    await expect(checkExitAddress(answering(200, '{"proxy":{}}'))).rejects.toThrow('unexpected')
  })
})
