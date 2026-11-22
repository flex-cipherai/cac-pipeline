import { supabase } from './supabase'

// LinkedIn accounts this person can work with: every Company Page the BMS
// manages (status 'active', chosen in Settings → Integrations) and their own
// profile. Company Pages first, then by name.
export async function fetchPostableAccounts(profileId) {
  const { data } = await supabase
    .from('connected_accounts')
    .select('*')
    .eq('platform', 'linkedin')
    .eq('status', 'active')
  return (data || [])
    .filter(a => a.account_type === 'organization' || a.owner_profile_id === profileId)
    .sort((a, b) =>
      (a.account_type === 'organization' ? 0 : 1) - (b.account_type === 'organization' ? 0 : 1)
      || a.account_name.localeCompare(b.account_name))
}

export function accountLabel(account) {
  if (!account) return ''
  return `${account.account_type === 'member' ? '👤' : '🏢'} ${account.account_name}`
}

// The account a new item defaults to: the first managed Company Page.
export function defaultAccountId(accounts) {
  return (accounts.find(a => a.account_type === 'organization') || accounts[0])?.id || ''
}
