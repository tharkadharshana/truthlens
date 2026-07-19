# TruthLens — Legal Claim Verification API

Next.js 16 fullstack. Public free tier (no key, 10 req/hr/IP). Pro tier (API key, 1,000 req/hr) with a usage/billing dashboard. Verifies legal claims against a pgvector corpus of statutes and case law, returning a structured verdict with what's wrong, what's missing, and a real citation.

## What's inside

```
app/
  page.tsx                  landing + live demo + dual rate-limit counters
  login/page.tsx            magic-link sign in (Supabase)
  dashboard/                server-guarded; API key mgmt + monthly usage table
  api/v1/check/route.ts     the public API
  api/keys/route.ts         create / list / revoke keys (hashed)
  api/usage/route.ts        monthly billing rollup
  api/stats/route.ts        global counter
  api/auth/route.ts         OAuth code exchange
lib/                        db, redis, ratelimit, pipeline, llm, keys, auth (all lazy-init)
proxy.ts                    optimistic cookie gate for /dashboard (Next 16 convention)
scripts/ingest.ts           corpus builder (run locally / via GitHub Actions)
scripts/check.ts            logic self-check — `npm run check`
schema.sql                  full DB schema + RPCs
```

## Security / correctness notes

- API keys are stored as **sha256 hashes**, never plaintext. The raw key is shown once at creation.
- Auth decisions use **`getUser()`** (validates the JWT), never `getSession()`.
- Rate-limit identifier is the key hash (pro) or the **first** `x-forwarded-for` IP (free); a missing IP header gets a unique token so anonymous users can't share one bucket.
- Pipeline caps at **8 claims/request**, isolates per-claim errors, and wraps the claim in injection-defense delimiters.
- Every request writes a `usage_logs` row (billable unit = LLM calls) — the dashboard reads a monthly rollup from it.

## Deploy (≈10 min)

You need free accounts: Supabase, Upstash, Google AI Studio, Vercel. Optionally OpenAI and/or DeepSeek if you want a different verify-step model (see step 3).

### 1. Supabase
- New project → SQL Editor → paste all of `schema.sql` → Run.
- Authentication → Providers → enable **Email** (magic link).
- Authentication → URL Configuration:
  - Site URL: `https://YOUR-APP.vercel.app`
  - Redirect URLs: add `https://YOUR-APP.vercel.app/api/auth`
- Settings → API: copy Project URL, anon key, service_role key.

### 2. Upstash
- Create a Redis database (global). Copy the **REST URL** and **REST token**.

### 3. Google AI Studio
- aistudio.google.com/apikey → create key.

### 4. Seed the corpus (local, before first deploy)
```bash
cp .env.example .env.local   # fill in all values
npm install
npm run ingest -- statutes   # ~50 chunks, fast
npm run ingest -- caselaw    # slower, optional for MVP
```
Then in Supabase SQL Editor run once:
```sql
ANALYZE public.corpus_chunks;
```

### 5. Deploy
```bash
npm i -g vercel
vercel            # link / create project
# add the env vars (Project Settings → Environment Variables):
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#   SUPABASE_SERVICE_ROLE_KEY, UPSTASH_REDIS_REST_URL,
#   UPSTASH_REDIS_REST_TOKEN, GEMINI_API_KEY (required)
#   DEEPSEEK_API_KEY, OPENAI_API_KEY, LLM_PROVIDER (optional — see below)
vercel --prod
```

### 6. Monthly corpus refresh (optional)
Add the same secrets to your GitHub repo (Settings → Secrets → Actions). `.github/workflows/ingest.yml` re-runs ingestion on the 1st of each month.

## LLM providers
`GEMINI_API_KEY` is always required — corpus embeddings use Gemini's `text-embedding-004` regardless of verify provider, since the pgvector column is a fixed `vector(768)` (re-ingest the corpus if you ever need to change embedders).

The claim-verification step (compare claim vs. retrieved sources, return a verdict) can run on any of Gemini, OpenAI, or DeepSeek. Set any combination of `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`:
- With multiple keys set, priority is **DeepSeek → OpenAI → Gemini**.
- Set `LLM_PROVIDER=deepseek|openai|gemini` to pin one explicitly (errors if that key is missing).

## Local dev
```bash
npm run dev      # http://localhost:3000
npm run check    # logic self-check (no network needed)
```

## Notes / known ceilings (see `ponytail:` comments in source)
- Claim extraction is naive sentence-splitting — upgrade to a sentence segmenter if recall suffers.
- Corpus chunking is fixed-window — upgrade to sentence-aware chunking if embeddings dilute.
- >8 claims/request are truncated — add an async job queue (QStash) for long documents.

Verdicts are model-assisted and informational, not legal advice.
