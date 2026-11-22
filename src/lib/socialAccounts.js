import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'
import { platformOf } from './platforms'

// Connected social accounts (any platform). "Postable" = what this person may
// publish as: every managed (status 'active') page/business account, plus
// their own personal profile. Pages first, then by platform and name.

const PERSONAL_KINDS = ['member']

export function isPersonal(account) {
  return PERSONAL_KINDS.includes(account?.account_type)
}

function sortAccounts(list) {
  return [...list].sort((a, b) =>
    (isPersonal(a) ? 1 : 0) - (isPersonal(b) ? 1 : 0)
    || a.platform.localeCompare(b.platform)
    || a.account_name.localeCompare(b.account_name))
}

export async function fetchAllAccounts() {
  const { data } = await supabase.from('connected_accounts').select('*').order('created_at')
  return sortAccounts(data || [])
}

export async function fetchPostableAccounts(profileId) {
  const all = await fetchAllAccounts()
  return all.filter(a => a.status === 'active' && (!isPersonal(a) || a.owner_profile_id === profileId))
}

export function accountLabel(account) {
  if (!account) return ''
  return `${platformOf(account).name} · ${account.account_name}`
}

// The account a new item defaults to: the first managed page.
export function defaultAccountId(accounts) {
  return (accounts.find(a => !isPersonal(a)) || accounts[0])?.id || ''
}

// Accounts visible in the account bar (managed pages + every connected
// profile, so a team sees what everyone published), with the bar's selection
// remembered per browser. selected = [] means "All".
const STORAGE_KEY = 'sm.accountBar'

export function useSocialAccounts() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelectedState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
  })

  const reload = useCallback(async () => {
    const all = await fetchAllAccounts()
    setAccounts(all.filter(a => a.status === 'active'))
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  // Drop selections for accounts that no longer exist.
  const validSelected = selected.filter(id => accounts.some(a => a.id === id))

  const setSelected = useCallback((ids) => {
    setSelectedState(ids)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)) } catch { /* private mode */ }
  }, [])

  const selectedIds = validSelected.length ? validSelected : accounts.map(a => a.id)
  return { accounts, loading, selected: validSelected, selectedIds, setSelected, reload }
}
