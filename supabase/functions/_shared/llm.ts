// Thin Gemini client for the AI Gap Check. Kept to one function so the provider can be swapped without
// touching the assessment logic: callJson() takes the prompt and a parser and returns whatever the parser
// accepts. Models are tried in order (the configured model first, then the fallback), so a free-tier rate
// limit on one model does not stop the conversation.
//
// Secret: GEMINI_API_KEY (Google AI Studio). supabase secrets set GEMINI_API_KEY=...
// No Deno APIs are used here, so this file runs under Node for tests with a stubbed fetch.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

export type LlmFailure = 'not_configured' | 'busy' | 'blocked' | 'failed'

export class LlmError extends Error {
  code: LlmFailure
  constructor(code: LlmFailure, message: string) {
    super(message)
    this.name = 'LlmError'
    this.code = code
  }
}

export interface Content { role: 'user' | 'model'; parts: { text: string }[] }

export interface CallOptions {
  apiKey: string | undefined
  models: string[]
  system: string
  contents: Content[]
  maxOutputTokens: number
  temperature: number
  timeoutMs?: number
  // Total time for all attempts on all models; no new attempt starts once it is nearly used up.
  budgetMs?: number
  fetchImpl?: typeof fetch
}

export interface CallResult<T> {
  value: T
  model: string
  inputTokens: number
  outputTokens: number
}

function extractText(data: any): { text: string; finish: string; blocked: boolean } {
  const cand = data?.candidates?.[0]
  const parts: any[] = cand?.content?.parts || []
  const text = parts.filter(p => typeof p?.text === 'string' && !p.thought).map(p => p.text).join('')
  return { text, finish: String(cand?.finishReason || ''), blocked: !!data?.promptFeedback?.blockReason }
}

export async function callJson<T>(opts: CallOptions, parse: (text: string) => T | null): Promise<CallResult<T>> {
  if (!opts.apiKey) throw new LlmError('not_configured', 'GEMINI_API_KEY is not set. Run: supabase secrets set GEMINI_API_KEY=...')
  const doFetch = opts.fetchImpl || fetch
  const models = [...new Set(opts.models.filter(Boolean))]
  if (!models.length) throw new LlmError('not_configured', 'No model configured')

  const startedAt = Date.now()
  const budget = opts.budgetMs ?? 110000
  let sawBusy = false
  let sawBlocked = false
  let lastMessage = ''

  for (const model of models) {
    // A busy model gets one more try after a short pause when it is the only one left.
    const attempts = model === models[models.length - 1] ? 2 : 1
    for (let attempt = 0; attempt < attempts; attempt++) {
      const remaining = budget - (Date.now() - startedAt)
      if (remaining < 4000) { sawBusy = true; lastMessage ||= 'time budget used up'; break }
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), Math.min(opts.timeoutMs ?? 45000, remaining))
      try {
        const res = await doFetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: opts.system }] },
            contents: opts.contents,
            generationConfig: {
              temperature: opts.temperature,
              maxOutputTokens: opts.maxOutputTokens,
              responseMimeType: 'application/json',
            },
          }),
          signal: ctrl.signal,
        })
        if (res.status === 429 || res.status === 503 || res.status === 500) {
          sawBusy = true
          lastMessage = `${model}: HTTP ${res.status}`
          if (attempt + 1 < attempts) await new Promise(r => setTimeout(r, 1500))
          continue
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          lastMessage = `${model}: HTTP ${res.status} ${body.slice(0, 200)}`
          break // 400 / 403 / 404: this model will not work, go to the next
        }
        const data = await res.json().catch(() => null)
        const { text, finish, blocked } = extractText(data)
        if (blocked || /SAFETY|PROHIBITED|BLOCKLIST/.test(finish)) { sawBlocked = true; lastMessage = `${model}: blocked (${finish || 'prompt'})`; break }
        if (finish === 'MAX_TOKENS') { lastMessage = `${model}: output cut off`; break }
        const value = text ? parse(text) : null
        if (value === null || value === undefined) { lastMessage = `${model}: unusable output`; break }
        return {
          value, model,
          inputTokens: Number(data?.usageMetadata?.promptTokenCount) || 0,
          outputTokens: Number(data?.usageMetadata?.candidatesTokenCount) || 0,
        }
      } catch (err) {
        lastMessage = `${model}: ${(err as Error).name === 'AbortError' ? 'timed out' : (err as Error).message}`
        sawBusy = true
      } finally {
        clearTimeout(timer)
      }
    }
  }
  if (sawBlocked && !sawBusy) throw new LlmError('blocked', lastMessage)
  throw new LlmError(sawBusy ? 'busy' : 'failed', lastMessage || 'Model call failed')
}
