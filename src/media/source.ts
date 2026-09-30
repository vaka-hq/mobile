import { HttpError, request } from '@/lib/http'

/** Random access to a media file, whether streamed over HTTP or held in memory by a test. */
export type ByteSource = {
  size(): Promise<number | null>
  read(offset: number, length: number): Promise<Uint8Array>
}

export function memorySource(bytes: Uint8Array): ByteSource {
  return {
    size: async () => bytes.length,
    read: async (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length)),
  }
}

/** Metadata would need more than the read budget; distinct from a failed request. */
export class ReadBudgetExceededError extends Error {
  constructor() {
    super('Reading chapters needed more data than expected')
    this.name = 'ReadBudgetExceededError'
  }
}

const blockSize = 64 * 1024

/** Metadata never needs more than this; a runaway parse must not download a whole book. */
const defaultBudget = 12 * 1024 * 1024

/**
 * HTTP Range reads in aligned 64 KiB blocks. Box and frame headers usually sit close together, so
 * a block cache turns dozens of tiny reads into a handful of requests.
 */
export function httpSource(url: string, signal?: AbortSignal, budget = defaultBudget): ByteSource {
  const blocks = new Map<number, Uint8Array>()
  let totalSize: number | null = null
  let fetched = 0

  async function fetchBlocks(first: number, last: number) {
    const start = first * blockSize
    const end = (last + 1) * blockSize - 1

    if (fetched + (end - start + 1) > budget) {
      throw new ReadBudgetExceededError()
    }

    const bytes = await request(
      url,
      { headers: { Range: `bytes=${start}-${end}` }, signal },
      async (response) => {
        if (response.status !== 206) {
          throw new HttpError(
            response.ok
              ? 'The stream does not support range requests'
              : `The stream answered ${response.status}`,
            response.status,
          )
        }

        const range = /\/(\d+)$/u.exec(response.headers.get('Content-Range') ?? '')

        if (range?.[1]) {
          totalSize = Number(range[1])
        }

        return new Uint8Array(await response.arrayBuffer())
      },
    )

    fetched += bytes.length

    for (let block = first; block <= last; block += 1) {
      const offset = (block - first) * blockSize

      if (offset < bytes.length) {
        blocks.set(block, bytes.subarray(offset, Math.min(bytes.length, offset + blockSize)))
      }
    }
  }

  async function ensure(first: number, last: number) {
    let missingStart: number | null = null

    for (let block = first; block <= last + 1; block += 1) {
      const missing = block <= last && !blocks.has(block)

      if (missing && missingStart === null) {
        missingStart = block
      } else if (!missing && missingStart !== null) {
        await fetchBlocks(missingStart, block - 1)
        missingStart = null
      }
    }
  }

  return {
    async size() {
      if (totalSize === null) {
        await ensure(0, 0)
      }

      return totalSize
    },
    async read(offset, length) {
      if (length <= 0) {
        return new Uint8Array(0)
      }

      const first = Math.floor(offset / blockSize)
      const last = Math.floor((offset + length - 1) / blockSize)

      await ensure(first, last)

      const result = new Uint8Array(length)
      let written = 0

      for (let block = first; block <= last; block += 1) {
        const data = blocks.get(block)

        if (!data) {
          break
        }

        const from = block === first ? offset - block * blockSize : 0
        const to = Math.min(data.length, from + (length - written))

        if (from >= to) {
          break
        }

        result.set(data.subarray(from, to), written)
        written += to - from
      }

      return result.subarray(0, written)
    },
  }
}
