import { createHash } from 'crypto'
import { getRedis } from './redis'
import { isRetryableStatus } from './llm'

// Web-mode evidence gathering for the `general` domain (lib/domains.ts).
// Each provider is a small self-contained function returning Evidence[], failing
// silently to [] so one dead provider never sinks a request. gatherEvidence()
// runs them in parallel, merges, dedupes, and caps. Adding a future source =
// one function + one line in gatherEvidence.

export type EvidenceKind = 'factcheck' | 'wiki' | 'web' | 'news' | 'corpus'

export type Evidence = {
  source_name: string
  source_url: string
  snippet: string
  kind: EvidenceKind
}

const EVIDENCE_CAP = 10
const CACHE_TTL_SECONDS = 60 * 60 * 24 // 24h — viral/repeat claims reuse the lookup

// ── Pure helpers (unit-tested in scripts/check.ts) ───────────────────

// Fact-checks first (a professional verdict outweighs a raw search snippet),
// then dedupe by URL, then cap. Order within a kind is preserved.
const KIND_RANK: Record<EvidenceKind, number> = { factcheck: 0, corpus: 0, wiki: 1, news: 2, web: 3 }

export function dedupeAndCap(items: Evidence[], cap = EVIDENCE_CAP): Evidence[] {
  const seen = new Set<string>()
  const sorted = [...items].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])
  const out: Evidence[] = []
  for (const e of sorted) {
    const key = e.source_url || e.snippet
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
    if (out.length >= cap) break
  }
  return out
}

export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

const STOPWORDS = new Set([
  'is', 'are', 'was', 'were', 'be', 'been', 'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for',
  'and', 'or', 'that', 'this', 'it', 'its', 'by', 'with', 'from', 'as', 'has', 'have', 'had', 'do',
  'does', 'did', 'will', 'would', 'can', 'could', 'not', 'no', 'their', 'there', 'which', 'who',
  'what', 'when', 'where', 'why', 'how', 'recently', 'new', 'current',
])

// GNews ANDs every query term, so the pipeline's natural-language search query
// ("Sri Lanka recently signed a new IMF loan agreement") matches zero articles.
// Proper nouns carry the topic, so prefer them and keep the query short.
// ponytail: capitalization heuristic. Ceiling: misses topics with no proper
// nouns, and non-Latin scripts have no case. Upgrade: ask the LLM for a short
// news query alongside the search query if recall matters.
export function newsQuery(query: string, maxWords = 4): string {
  const words = query.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  const significant = words.filter((w) => !STOPWORDS.has(w.toLowerCase()))
  const proper = significant.filter((w) => /^\p{Lu}/u.test(w))
  return (proper.length >= 2 ? proper : significant).slice(0, maxWords).join(' ')
}

// ── Network helper ───────────────────────────────────────────────────
// One transient retry for 429/503 (reuses the same retryable-status policy as
// embeddings). Any other failure resolves to null — callers map that to [].
async function fetchJson(url: string, init?: RequestInit, attempts = 2): Promise<any | null> {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, init)
      if (res.ok) return await res.json()
      if (!isRetryableStatus(res.status) || i === attempts) return null
      await new Promise((r) => setTimeout(r, 500 * i))
    } catch {
      if (i === attempts) return null
    }
  }
  return null
}

// ── Providers ────────────────────────────────────────────────────────

// Google Fact Check Tools — professional fact-checks (PolitiFact/Snopes/AFP).
// Free; runs on both tiers. Only covers claims pros have already checked, so
// it's a high-value bonus layer, not a guaranteed hit.
async function searchFactCheck(query: string): Promise<Evidence[]> {
  const key = process.env.GOOGLE_FACTCHECK_API_KEY
  if (!key) return []
  const url = `https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${encodeURIComponent(query)}&languageCode=en&pageSize=5&key=${key}`
  const data = await fetchJson(url)
  const out: Evidence[] = []
  for (const claim of data?.claims ?? []) {
    for (const review of claim.claimReview ?? []) {
      const publisher = review.publisher?.name ?? 'Fact-checker'
      const rating = review.textualRating ?? 'reviewed'
      if (!review.url) continue
      out.push({
        source_name: publisher,
        source_url: review.url,
        snippet: `${publisher} rated the claim "${claim.text ?? query}": ${rating}.`,
        kind: 'factcheck',
      })
    }
  }
  return out
}

// Wikipedia — clean plaintext intros in a single call via the extracts
// generator. Free, no key, both tiers.
async function searchWikipedia(query: string): Promise<Evidence[]> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    `&prop=extracts&exintro=1&explaintext=1&exsentences=3` +
    `&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=3`
  const data = await fetchJson(url, { headers: { 'User-Agent': 'TruthLens/1.0' } })
  const pages = data?.query?.pages
  if (!pages) return []
  const out: Evidence[] = []
  for (const p of Object.values(pages) as any[]) {
    const extract = (p.extract ?? '').trim()
    if (!extract) continue
    out.push({
      source_name: `Wikipedia: ${p.title}`,
      source_url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
      snippet: extract,
      kind: 'wiki',
    })
  }
  return out
}

// Tavily — LLM-optimized search returning extracted page content. Paid tier.
async function searchTavily(query: string): Promise<Evidence[]> {
  const key = process.env.TAVILY_API_KEY
  if (!key) return []
  const data = await fetchJson('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: 'basic',
      include_answer: false,
      max_results: 5,
    }),
  })
  return (data?.results ?? [])
    .filter((r: any) => r.url && r.content)
    .map((r: any): Evidence => ({
      source_name: r.title || r.url,
      source_url: r.url,
      snippet: stripHtml(String(r.content)).slice(0, 500),
      kind: 'web',
    }))
}

// GNews — current-events coverage. Optional (needs key), paid tier.
async function searchGNews(query: string): Promise<Evidence[]> {
  const key = process.env.GNEWS_API_KEY
  if (!key) return []
  const q = newsQuery(query)
  if (!q) return []
  const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&max=5&token=${key}`
  const data = await fetchJson(url)
  return (data?.articles ?? [])
    .filter((a: any) => a.url && (a.description || a.title))
    .map((a: any): Evidence => ({
      source_name: a.source?.name ? `${a.source.name}` : (a.title || a.url),
      source_url: a.url,
      snippet: stripHtml(String(a.description || a.title)),
      kind: 'news',
    }))
}

// ── Orchestration ────────────────────────────────────────────────────

function cacheKey(query: string, full: boolean): string {
  const h = createHash('sha256').update(query.trim().toLowerCase()).digest('hex')
  return `ev:${h}:${full ? 1 : 0}`
}

// Always: fact-check + Wikipedia (free, both tiers). Full (paid): adds Tavily
// + GNews. Redis-cached per (query, tier) to protect quotas.
export async function gatherEvidence(query: string, full: boolean): Promise<Evidence[]> {
  const redis = getRedis()
  const key = cacheKey(query, full)
  try {
    const cached = await redis.get<Evidence[]>(key)
    if (cached) return cached
  } catch { /* cache read failure is non-fatal */ }

  const providers = full
    ? [searchFactCheck(query), searchWikipedia(query), searchTavily(query), searchGNews(query)]
    : [searchFactCheck(query), searchWikipedia(query)]

  const settled = await Promise.allSettled(providers)
  const merged: Evidence[] = []
  for (const s of settled) {
    if (s.status === 'fulfilled') merged.push(...s.value)
  }
  const result = dedupeAndCap(merged)

  if (result.length) {
    try { await redis.set(key, result, { ex: CACHE_TTL_SECONDS }) } catch { /* non-fatal */ }
  }
  return result
}
