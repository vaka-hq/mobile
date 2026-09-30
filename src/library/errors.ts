/** The book has no stream to play or download yet, and no copy on the phone. */
export class NotStreamableError extends Error {
  constructor() {
    super('This audiobook is not ready to stream yet')
    this.name = 'NotStreamableError'
  }
}

/** A site answered with something the app cannot read, such as a changed page. */
export class UnexpectedAnswerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnexpectedAnswerError'
  }
}
