import { CloudError, CloudErrorCode } from './errors.js'
import type { CloudRequest, JsonValue } from './types.js'

export interface StoredResult {
  ref: string
  request: CloudRequest
  data: JsonValue
  requestId?: string
  createdAt: number
  bytes: number
}

interface SessionBucket {
  next: number
  entries: Map<string, StoredResult>
  bytes: number
}

export interface ResultStoreLimits {
  maxEntries: number
  maxBytes: number
}

/**
 * Per-session LRU of full `cloud_call` results, addressed by `r1`, `r2`, ….
 * Memory only: refs do not survive a host restart.
 */
export class ResultStore {
  private readonly sessions = new Map<string, SessionBucket>()

  constructor(private readonly limits: ResultStoreLimits) {}

  put(session: string, request: CloudRequest, data: JsonValue, requestId?: string): StoredResult {
    const bucket = this.bucket(session)
    const ref = `r${++bucket.next}`
    const bytes = Buffer.byteLength(JSON.stringify(data))
    const entry: StoredResult = { ref, request, data, requestId, createdAt: Date.now(), bytes }
    bucket.entries.set(ref, entry)
    bucket.bytes += bytes
    while (bucket.entries.size > 1 && (bucket.entries.size > this.limits.maxEntries || bucket.bytes > this.limits.maxBytes)) {
      const [oldest, evicted] = bucket.entries.entries().next().value as [string, StoredResult]
      bucket.entries.delete(oldest)
      bucket.bytes -= evicted.bytes
    }
    return entry
  }

  get(session: string, ref: string): StoredResult {
    const bucket = this.sessions.get(session)
    const entry = bucket?.entries.get(ref)
    if (!bucket || !entry) {
      throw new CloudError(CloudErrorCode.REF_EXPIRED, `result "${ref}" is not available (expired or from another session); call cloud_call again`)
    }
    bucket.entries.delete(ref)
    bucket.entries.set(ref, entry)
    return entry
  }

  dropSession(session: string): void {
    this.sessions.delete(session)
  }

  private bucket(session: string): SessionBucket {
    let bucket = this.sessions.get(session)
    if (!bucket) {
      bucket = { next: 0, entries: new Map(), bytes: 0 }
      this.sessions.set(session, bucket)
    }
    return bucket
  }
}
