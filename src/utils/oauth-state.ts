import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

function getSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET
  if (!secret) throw new Error('OAUTH_STATE_SECRET env var is required')
  return secret
}

export function generateState(userId: string): string {
  const nonce = randomBytes(16).toString('hex')
  const payload = `${userId}:${nonce}`
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex')
  return Buffer.from(`${payload}:${sig}`).toString('base64url')
}

export function verifyState(state: string, expectedUserId: string): boolean {
  try {
    const decoded = Buffer.from(state, 'base64url').toString()
    const lastColon = decoded.lastIndexOf(':')
    const payload = decoded.slice(0, lastColon)
    const sig = decoded.slice(lastColon + 1)
    const expectedSig = createHmac('sha256', getSecret()).update(payload).digest('hex')
    if (sig.length !== expectedSig.length) return false
    const valid = timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))
    const userId = payload.split(':')[0]
    return valid && userId === expectedUserId
  } catch {
    return false
  }
}
