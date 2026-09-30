/**
 * Runs at most `max` tasks at once, queueing the rest in order. Shared by callers that would
 * otherwise start many requests to one site together and get throttled.
 */
export function concurrencyLimit(max: number) {
  let running = 0
  const queue: (() => void)[] = []

  function next() {
    if (running >= max) {
      return
    }

    const start = queue.shift()

    if (start) {
      running += 1
      start()
    }
  }

  return function limited<T>(task: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            running -= 1
            next()
          })
      })
      next()
    })
  }
}
