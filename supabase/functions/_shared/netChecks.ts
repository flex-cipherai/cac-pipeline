// Network checks for the AI Gap Check: does the visitor's email domain receive mail, and what does their
// website say. Both use DNS over HTTPS (Cloudflare, then Google) instead of Deno.resolveDns, so they behave
// the same on Supabase's hosted runtime and under Node tests with a stubbed fetch.
//
// Fetching a URL a visitor typed is a server-side request forgery risk, so every hop (the address itself
// and each redirect) must be a public hostname that resolves only to public IP addresses, only http(s) on
// the default ports is allowed, and the body is size and time limited. The text is used as background for
// the interviewer and is never shown to the visitor.

import { extractSiteSummary, isPrivateIp, normaliseWebsite } from './gapAssessment.ts'

type Rtype = 'A' | 'AAAA' | 'MX'
const TYPE_CODE: Record<Rtype, number> = { A: 1, AAAA: 28, MX: 15 }

export interface DnsResult { status: 'ok' | 'nxdomain' | 'error'; answers: string[] }
export type Resolver = (host: string, type: Rtype) => Promise<DnsResult>

async function doh(base: string, host: string, type: Rtype, f: typeof fetch): Promise<DnsResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 3500)
  try {
    const res = await f(`${base}?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: ctrl.signal })
    if (!res.ok) return { status: 'error', answers: [] }
    const data: any = await res.json()
    if (data.Status === 3) return { status: 'nxdomain', answers: [] }
    if (data.Status !== 0) return { status: 'error', answers: [] }
    const answers = (data.Answer || []).filter((a: any) => a.type === TYPE_CODE[type]).map((a: any) => String(a.data).trim())
    return { status: 'ok', answers }
  } catch {
    return { status: 'error', answers: [] }
  } finally {
    clearTimeout(timer)
  }
}

export function makeResolver(f: typeof fetch = fetch): Resolver {
  return async (host, type) => {
    const first = await doh('https://cloudflare-dns.com/dns-query', host, type, f)
    if (first.status !== 'error') return first
    return doh('https://dns.google/resolve', host, type, f)
  }
}

// true: mail can be delivered there. false: the domain does not exist or accepts no mail.
// 'unknown': DNS did not answer, so do not turn a real customer away over it.
export async function domainReceivesMail(domain: string, resolve: Resolver): Promise<boolean | 'unknown'> {
  const mx = await resolve(domain, 'MX')
  if (mx.status === 'nxdomain') return false
  if (mx.status === 'error') return 'unknown'
  const hosts = mx.answers.map(a => a.split(/\s+/)[1] || '').filter(h => h && h !== '.')
  if (hosts.length) return true
  // RFC 5321: no MX means mail goes to the domain's own address record, if it has one.
  const a = await resolve(domain, 'A')
  if (a.status === 'error') return 'unknown'
  if (a.answers.length) return true
  const aaaa = await resolve(domain, 'AAAA')
  if (aaaa.status === 'error') return 'unknown'
  return aaaa.answers.length > 0
}

// Resolves to public addresses only; false for anything that resolves to a private one.
export async function hostIsPublic(host: string, resolve: Resolver): Promise<boolean> {
  const [a, aaaa] = await Promise.all([resolve(host, 'A'), resolve(host, 'AAAA')])
  const ips = [...a.answers, ...aaaa.answers].filter(x => /^[0-9a-f:.]+$/i.test(x))
  if (!ips.length) return false
  return ips.every(ip => !isPrivateIp(ip))
}

const MAX_BYTES = 250_000
const MAX_HOPS = 3

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done || !value) break
    chunks.push(value)
    total += value.length
  }
  try { await reader.cancel() } catch { /* already closed */ }
  const all = new Uint8Array(Math.min(total, MAX_BYTES))
  let off = 0
  for (const c of chunks) { const room = all.length - off; if (room <= 0) break; all.set(c.subarray(0, room), off); off += Math.min(c.length, room) }
  return new TextDecoder('utf-8', { fatal: false }).decode(all)
}

// A short text description of the site, or '' if it cannot be read safely. Never throws.
export async function fetchSiteSummary(url: string, resolve: Resolver, f: typeof fetch = fetch, totalMs = 7000): Promise<string> {
  const deadline = Date.now() + totalMs
  try {
    let current = url
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const site = normaliseWebsite(current)
      if (!site || !(await hostIsPublic(site.host, resolve))) return ''
      const left = deadline - Date.now()
      if (left < 500) return ''
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), left)
      let res: Response
      try {
        res = await f(site.url, {
          redirect: 'manual', signal: ctrl.signal,
          headers: { 'User-Agent': 'SDFM-GapCheck/1.0 (+https://sdfmgroup.com)', Accept: 'text/html,application/xhtml+xml' },
        })
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location')
          await res.body?.cancel().catch(() => {})
          if (!loc) return ''
          current = new URL(loc, site.url).toString()
          continue
        }
        if (!res.ok) { await res.body?.cancel().catch(() => {}); return '' }
        const type = (res.headers.get('content-type') || '').toLowerCase()
        if (type && !/text\/html|application\/xhtml|text\/plain/.test(type)) { await res.body?.cancel().catch(() => {}); return '' }
        return extractSiteSummary(await readCapped(res))
      } finally {
        clearTimeout(timer)
      }
    }
    return ''
  } catch {
    return ''
  }
}
