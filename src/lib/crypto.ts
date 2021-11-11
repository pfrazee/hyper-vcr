import { createHash } from 'crypto'

export function hash (buf: Buffer): string {
  const hashSum = createHash('sha256')
  hashSum.update(buf)
  return `sha256-${hashSum.digest('hex')}`
}