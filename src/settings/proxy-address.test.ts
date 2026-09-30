import { describe, expect, it } from 'vitest'
import { parseProxyAddress, parseProxyPort } from './proxy-address'

describe('proxy addresses', () => {
  it('keeps the host, and the port when one is written', () => {
    expect(parseProxyAddress(' isp.decodo.com ')).toEqual({ host: 'isp.decodo.com', port: null })
    expect(parseProxyAddress('http://ISP.decodo.com:10000/')).toEqual({
      host: 'isp.decodo.com',
      port: 10_000,
    })
    expect(parseProxyAddress('user:secret@isp.decodo.com:10001')).toEqual({
      host: 'isp.decodo.com',
      port: 10_001,
    })
    expect(parseProxyAddress('192.0.2.10:8080')).toEqual({ host: '192.0.2.10', port: 8080 })
  })

  it('rejects text without a host', () => {
    expect(() => parseProxyAddress('')).toThrow()
    expect(() => parseProxyAddress('http://')).toThrow()
  })
})

describe('proxy ports', () => {
  it('reads a port from 1 to 65535', () => {
    expect(parseProxyPort(' 8080 ')).toBe(8080)
    expect(parseProxyPort('1')).toBe(1)
    expect(parseProxyPort('65535')).toBe(65_535)
  })

  it('rejects anything else', () => {
    expect(parseProxyPort('')).toBeNull()
    expect(parseProxyPort('0')).toBeNull()
    expect(parseProxyPort('65536')).toBeNull()
    expect(parseProxyPort('80a')).toBeNull()
    expect(parseProxyPort('-1')).toBeNull()
  })
})
