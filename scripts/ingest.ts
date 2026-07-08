import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { embedText } from '../lib/llm'
import type { Domain } from '../lib/domains'

// Run: npm run ingest -- statutes | caselaw | finra | all
// Never runs on Vercel. Local or GitHub Actions only.

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// ponytail: fixed-window char chunking, 512/64. Ceiling: splits mid-sentence,
// dilutes embeddings. Upgrade: sentence-aware chunking if recall is poor.
function chunk(text: string, size = 512, overlap = 64): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size - overlap) out.push(text.slice(i, i + size))
  return out
}

function contentHash(url: string, content: string): string {
  return createHash('sha256').update(url + '\u0000' + content).digest('hex')
}

// ponytail: serialized with a fixed delay to stay under gemini-embedding-001's
// free-tier cap (100 req/min). Ceiling: slow for large corpora. Upgrade: token
// -bucket keyed off actual rate-limit headers if this proves too conservative.
const EMBED_DELAY_MS = 700 // ~85 req/min, under the 100/min free-tier cap

async function embedBatch(texts: string[]): Promise<number[][]> {
  const out: number[][] = []
  for (const t of texts) {
    out.push(await embedText(t))
    await new Promise((r) => setTimeout(r, EMBED_DELAY_MS))
  }
  return out
}

async function upsert(chunks: string[], embeds: number[][], domain: Domain, source_name: string, source_url: string) {
  const rows = chunks.map((content, i) => ({
    content,
    embedding: JSON.stringify(embeds[i]),
    content_hash: contentHash(source_url, content),
    domain,
    source_name,
    source_url,
    updated_at: new Date().toISOString(),
  }))
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db.from('corpus_chunks').upsert(rows.slice(i, i + 100), { onConflict: 'content_hash' })
    if (error) console.error('  upsert error:', error.message)
    else console.log(`  inserted ${Math.min(i + 100, rows.length)}/${rows.length}`)
  }
}

// Shared shape for any domain whose source is a set of plain HTML pages:
// fetch, strip tags, chunk, embed, upsert. Statutes and FINRA/SEC rules both
// ingest this way — only the domain tag and page list differ.
async function ingestPages(domain: Domain, pages: { name: string; url: string }[]) {
  for (const p of pages) {
    console.log(`${domain}: ${p.name}`)
    const res = await fetch(p.url, { headers: { 'User-Agent': 'TruthLens-ingest/1.0' } })
    if (!res.ok) { console.warn(`  skip (${res.status})`); continue }
    const html = await res.text()
    // ponytail: regex tag-strip. Ceiling: keeps some boilerplate. Upgrade: cheerio.
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
    if (text.length < 100) { console.warn('  too short, skip'); continue }
    const c = chunk(text)
    console.log(`  ${c.length} chunks`)
    await upsert(c, await embedBatch(c), domain, p.name, p.url)
  }
}

async function ingestStatutes() {
  // ponytail: hardcoded high-value statutes for MVP corpus. Ceiling: tiny coverage.
  // Upgrade: crawl full USC / CFR tables of contents.
  await ingestPages('legal_statute', [
    { name: 'Section 230 (47 USC 230)', url: 'https://www.law.cornell.edu/uscode/text/47/230' },
    { name: 'Fourth Amendment', url: 'https://www.law.cornell.edu/constitution/fourth_amendment' },
    { name: 'DMCA Safe Harbor (17 USC 512)', url: 'https://www.law.cornell.edu/uscode/text/17/512' },
    { name: 'ADA Title I (42 USC 12111)', url: 'https://www.law.cornell.edu/uscode/text/42/12111' },
    { name: 'FCRA (15 USC 1681)', url: 'https://www.law.cornell.edu/uscode/text/15/1681' },
    { name: 'Copyright fair use (17 USC 107)', url: 'https://www.law.cornell.edu/uscode/text/17/107' },
    { name: 'Sherman Act (15 USC 1)', url: 'https://www.law.cornell.edu/uscode/text/15/1' },
  ])
}

async function ingestCaselaw(maxPages = 3) {
  console.log('CourtListener: fetching opinions…')
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`https://www.courtlistener.com/api/rest/v4/opinions/?page=${page}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'TruthLens-ingest/1.0' },
    })
    if (!res.ok) { console.error('  CourtListener error', res.status); break }
    const data = await res.json()
    for (const op of data.results ?? []) {
      const text: string = op.plain_text || ''
      if (text.length < 200) continue
      const c = chunk(text)
      console.log(`  opinion ${op.id}: ${c.length} chunks`)
      await upsert(c, await embedBatch(c), 'legal_statute', 'CourtListener', op.absolute_url ? `https://www.courtlistener.com${op.absolute_url}` : op.id?.toString() ?? '')
    }
    if (!data.next) break
  }
}

async function ingestFinra() {
  // ponytail: hardcoded high-value rules for MVP corpus. Ceiling: tiny coverage,
  // and finra.org itself has bot-protection (429s on scripted fetches) so this
  // sticks to sources confirmed plain-fetchable. Upgrade: add more rules/sources
  // as the finra_compliance domain proves out.
  await ingestPages('finra_compliance', [
    { name: 'SEC Marketing Rule (17 CFR 275.206(4)-1)', url: 'https://www.law.cornell.edu/cfr/text/17/275.206(4)-1' },
  ])
}

async function main() {
  const target = process.argv[2] ?? 'all'
  if (target === 'statutes' || target === 'all') await ingestStatutes()
  if (target === 'caselaw' || target === 'all') await ingestCaselaw(3)
  if (target === 'finra' || target === 'all') await ingestFinra()
  console.log('\nDone. Now run in Supabase SQL:  ANALYZE public.corpus_chunks;')
}

main().catch((e) => { console.error(e); process.exit(1) })
