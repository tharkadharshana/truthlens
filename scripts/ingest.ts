import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createHash } from 'crypto'

// Run: npm run ingest -- statutes | caselaw | all
// Never runs on Vercel. Local or GitHub Actions only.

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const embedModel = gemini.getGenerativeModel({ model: 'text-embedding-004' })

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

async function embedBatch(texts: string[]): Promise<number[][]> {
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100)
    const res = await Promise.all(batch.map((t) => embedModel.embedContent(t).then((r) => r.embedding.values)))
    out.push(...res)
    // ponytail: 1s pause between batches. Ceiling: assumes free-tier limits
    // (1500 rpm). Upgrade: token-bucket if hitting 429s.
    if (i + 100 < texts.length) await new Promise((r) => setTimeout(r, 1000))
  }
  return out
}

async function upsert(chunks: string[], embeds: number[][], source_name: string, source_url: string) {
  const rows = chunks.map((content, i) => ({
    content,
    embedding: JSON.stringify(embeds[i]),
    content_hash: contentHash(source_url, content),
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

async function ingestStatutes() {
  // ponytail: hardcoded high-value statutes for MVP corpus. Ceiling: tiny coverage.
  // Upgrade: crawl full USC / CFR tables of contents.
  const statutes = [
    { name: 'Section 230 (47 USC 230)', url: 'https://www.law.cornell.edu/uscode/text/47/230' },
    { name: 'Fourth Amendment', url: 'https://www.law.cornell.edu/constitution/fourth_amendment' },
    { name: 'DMCA Safe Harbor (17 USC 512)', url: 'https://www.law.cornell.edu/uscode/text/17/512' },
    { name: 'ADA Title I (42 USC 12111)', url: 'https://www.law.cornell.edu/uscode/text/42/12111' },
    { name: 'FCRA (15 USC 1681)', url: 'https://www.law.cornell.edu/uscode/text/15/1681' },
    { name: 'Copyright fair use (17 USC 107)', url: 'https://www.law.cornell.edu/uscode/text/17/107' },
    { name: 'Sherman Act (15 USC 1)', url: 'https://www.law.cornell.edu/uscode/text/15/1' },
  ]
  for (const s of statutes) {
    console.log(`Statute: ${s.name}`)
    const res = await fetch(s.url, { headers: { 'User-Agent': 'TruthLens-ingest/1.0' } })
    if (!res.ok) { console.warn(`  skip (${res.status})`); continue }
    const html = await res.text()
    // ponytail: regex tag-strip. Ceiling: keeps some boilerplate. Upgrade: cheerio.
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
    if (text.length < 100) { console.warn('  too short, skip'); continue }
    const c = chunk(text)
    console.log(`  ${c.length} chunks`)
    await upsert(c, await embedBatch(c), s.name, s.url)
  }
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
      await upsert(c, await embedBatch(c), 'CourtListener', op.absolute_url ? `https://www.courtlistener.com${op.absolute_url}` : op.id?.toString() ?? '')
    }
    if (!data.next) break
  }
}

async function main() {
  const target = process.argv[2] ?? 'all'
  if (target === 'statutes' || target === 'all') await ingestStatutes()
  if (target === 'caselaw' || target === 'all') await ingestCaselaw(3)
  console.log('\nDone. Now run in Supabase SQL:  ANALYZE public.corpus_chunks;')
}

main().catch((e) => { console.error(e); process.exit(1) })
