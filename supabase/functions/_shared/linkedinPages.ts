// Keeps one connected_accounts row (account_type 'organization') per
// LinkedIn Company Page the connecting member administers, so the BMS can
// manage any of them. Used by sm-linkedin-oauth-callback (on connect) and
// sm-linkedin-pages (Settings → Integrations → Refresh pages).
//
// Which pages the BMS actually manages is the row's `status`: 'active'
// pages appear under Post As, publish and sync; 'disconnected' ones are
// ignored. A page seen for the first time starts as 'disconnected' so
// nothing is posted to a page until an admin switches it on — except the
// very first page when no page is managed yet, so a fresh setup works.
// Existing rows keep their status (and their history).

import { fetchAdministeredOrganizations, fetchOrganizationName, tokenColumns } from './linkedin.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export interface PageSyncResult {
  pages: { id: string; name: string; urn: string; status: string; is_new: boolean }[]
}

export async function syncAdministeredPages(
  db: Db,
  accessToken: string,
  // Token columns to store for each page (from tokenColumns()), or a source
  // account whose stored token should be copied to every page.
  token: { columns?: ReturnType<typeof tokenColumns>; fromAccountId?: string },
  memberUrn: string | null,
): Promise<PageSyncResult> {
  const orgUrns = await fetchAdministeredOrganizations(accessToken)

  let columns = token.columns
  if (!columns && token.fromAccountId) {
    const { data } = await db
      .from('connected_account_tokens')
      .select('access_token, refresh_token, token_expires_at, refresh_token_expires_at, scope')
      .eq('account_id', token.fromAccountId)
      .single()
    columns = data
  }
  if (!columns) throw new Error('No LinkedIn token to store for the pages')

  const { data: existing } = await db
    .from('connected_accounts')
    .select('id, external_page_id, status, account_name')
    .eq('platform', 'linkedin')
    .eq('account_type', 'organization')
  const rows = existing || []
  let anyManaged = rows.some((r: { status: string; external_page_id: string | null }) => r.status === 'active' && r.external_page_id)

  const pages: PageSyncResult['pages'] = []
  for (const urn of orgUrns) {
    const name = (await fetchOrganizationName(accessToken, urn)) || urn
    let row = rows.find((r: { external_page_id: string | null }) => r.external_page_id === urn)
    let isNew = false

    if (row) {
      await db.from('connected_accounts').update({
        account_name: name, mode: 'automated', oauth_connected: true,
      }).eq('id', row.id)
    } else {
      // A seeded page row that was never linked to LinkedIn is reused for the
      // first page found, instead of leaving an empty row behind.
      const unlinked = rows.find((r: { external_page_id: string | null }) => !r.external_page_id)
      const status = anyManaged ? 'disconnected' : 'active'
      const fields = {
        platform: 'linkedin', account_type: 'organization', account_name: name, external_page_id: urn,
        mode: 'automated', oauth_connected: true, status,
      }
      if (unlinked) {
        await db.from('connected_accounts').update(fields).eq('id', unlinked.id)
        unlinked.external_page_id = urn
        row = { ...unlinked, status }
      } else {
        const { data: inserted, error } = await db.from('connected_accounts').insert(fields).select('id, external_page_id, status, account_name').single()
        if (error) throw new Error(`Could not save page ${name}: ${error.message}`)
        row = inserted
        rows.push(inserted)
      }
      isNew = true
      if (status === 'active') anyManaged = true
    }

    await db.from('connected_account_tokens').upsert({
      account_id: row.id, ...columns, ...(memberUrn ? { linkedin_member_urn: memberUrn } : {}),
    }, { onConflict: 'account_id' })

    pages.push({ id: row.id, name, urn, status: row.status, is_new: isNew })
  }
  return { pages }
}
