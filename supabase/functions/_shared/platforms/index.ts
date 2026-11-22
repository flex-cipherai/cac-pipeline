// Platform connector registry. To add a platform:
//   1. write _shared/platforms/<platform>.ts implementing Connector (types.ts),
//   2. register it below,
//   3. add its OAuth functions (sm-<platform>-oauth-start / -callback) that
//      create connected_accounts rows (platform, account_type, external_page_id)
//      and store tokens in connected_account_tokens,
//   4. flip its status to 'live' in src/lib/platforms.js.
// The engine, sync, inbox, analytics and UI need no other change.

import type { Connector } from './types.ts'
import { linkedinConnector } from './linkedin.ts'

const CONNECTORS: Record<string, Connector> = {
  linkedin: linkedinConnector,
  // facebook: facebookConnector,   (Meta Graph API — Pages)
  // instagram: instagramConnector, (Meta Graph API — Instagram Business)
  // threads: threadsConnector,     (Threads API)
  // tiktok: tiktokConnector,       (TikTok Content Posting API)
  // x: xConnector,                 (X API v2)
  // youtube: youtubeConnector,     (YouTube Data API)
}

export function getConnector(platform: string): Connector {
  const c = CONNECTORS[platform]
  if (!c) throw new Error(`${platform} is not connected to the BMS yet`)
  return c
}

export function hasConnector(platform: string) {
  return !!CONNECTORS[platform]
}
