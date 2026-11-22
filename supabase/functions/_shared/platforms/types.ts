// The contract every social platform connector implements. The publishing
// engine (_shared/publisher.ts), the sync job (_shared/socialSync.ts) and the
// inbox reply function only talk to platforms through this interface, so a
// new platform (Facebook/Instagram/Threads, TikTok, X, YouTube) is one file
// in this folder plus a line in index.ts — no engine or schema changes.
//
// The frontend mirror (names, limits, previews) is src/lib/platforms.js.

// deno-lint-ignore no-explicit-any
export type Db = any

// connected_accounts row (the fields connectors use).
export interface Account {
  id: string
  platform: string
  account_type: string
  account_name: string
  external_page_id: string // platform id of the page/profile (LinkedIn: urn:li:organization:X / urn:li:person:X)
  mode: string
  status: string
  timezone?: string
}

export interface MediaItem {
  asset_id: string
  kind: 'image' | 'video' | 'document'
  file_name: string
  file_path: string
  file_size: number | null
}

// What the engine hands a connector to publish. Media bytes are loaded on
// demand (loadBytes) so a connector that resumes an upload never downloads twice.
export interface PublishInput {
  // deno-lint-ignore no-explicit-any
  post: any // posts row
  account: Account
  token: string
  media: MediaItem[]
  loadBytes: (m: MediaItem) => Promise<Uint8Array>
  // Connector-owned resumable state (stored in posts.publish_state between runs).
  // deno-lint-ignore no-explicit-any
  state: Record<string, any>
  saveState: () => Promise<void>
}

export type PublishOutcome =
  | { kind: 'posted'; externalId: string; url: string }
  | { kind: 'pending'; reason: string } // e.g. a video still processing — try again next run

export interface Stats {
  impressions: number
  reach: number
  reactions: number
  comments: number
  shares: number
  clicks: number
  video_views?: number
}

export interface RemoteComment {
  externalId: string
  parentExternalId?: string | null
  authorName: string
  authorIsSelf: boolean
  text: string
  createdAt: string
}

export interface Capabilities {
  publish: boolean
  firstComment: boolean
  postStats: boolean
  followers: boolean
  comments: boolean
  reply: boolean
}

export interface Connector {
  platform: string
  // Which features this connector supports for an account type (LinkedIn
  // profiles, for example, cannot have comments synced).
  capabilities(account: Account): Capabilities
  getToken(db: Db, account: Account): Promise<string>
  // Throws PublishError for problems the user must fix (shown on the post).
  publish(input: PublishInput): Promise<PublishOutcome>
  postFirstComment?(token: string, account: Account, externalPostId: string, text: string): Promise<string>
  // Lifetime stats per external post id.
  postStats?(token: string, account: Account, externalPostIds: string[]): Promise<Map<string, Stats>>
  followerCount?(token: string, account: Account): Promise<number | null>
  listComments?(token: string, account: Account, externalPostId: string): Promise<RemoteComment[]>
  replyToComment?(token: string, account: Account, externalPostId: string, parentCommentId: string | null, text: string): Promise<string>
  postUrl(externalPostId: string): string
}

export class PublishError extends Error {}

export const zeroStats = (): Stats => ({ impressions: 0, reach: 0, reactions: 0, comments: 0, shares: 0, clicks: 0, video_views: 0 })
