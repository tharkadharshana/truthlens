-- TruthLens schema. Run in Supabase SQL editor.
-- Fixes vs v1: keys are HASHED (never plaintext), usage_logs added for billing,
-- match_corpus RPC + ANALYZE guidance, ownership-safe RLS.

create extension if not exists vector;
create extension if not exists pgcrypto;  -- for digest()

-- ── Profiles (public mirror of auth.users + billing state) ──────────
-- plan / subscription_status are the source of truth for paid access; they are
-- written ONLY by the Polar webhook (app/api/webhooks/polar), never by the user.
-- Access is derived from payment state, so a lapsed subscription drops to free.
create table if not exists public.profiles (
  id uuid references auth.users primary key,
  email text not null,
  polar_customer_id text,
  plan text not null default 'free',          -- 'free' | 'pro' | 'business' (see lib/plans.ts)
  subscription_status text,                    -- Polar status: active | canceled | past_due | ...
  current_period_end timestamptz,
  created_at timestamptz default now()
);
-- Idempotent for existing installs (table already created without these columns).
alter table public.profiles add column if not exists polar_customer_id text;
alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles add column if not exists subscription_status text;
alter table public.profiles add column if not exists current_period_end timestamptz;
create index if not exists profiles_polar_customer_idx on public.profiles(polar_customer_id);

-- ── API keys (HASHED — raw key shown once at creation, never stored) ─
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  key_hash text unique not null,        -- sha256(raw_key), hex
  key_prefix text not null,             -- first 11 chars e.g. 'tl_a1b2c3d' for display
  tier text not null default 'pro',
  created_at timestamptz default now(),
  last_used_at timestamptz,
  revoked boolean default false
);
create index if not exists api_keys_hash_idx on public.api_keys(key_hash) where revoked = false;

-- ── Usage logs (billing source of truth) ────────────────────────────
create table if not exists public.usage_logs (
  id bigint generated always as identity primary key,
  api_key_id uuid references public.api_keys(id) on delete set null, -- null = anonymous free tier
  identifier text not null,             -- key_hash or ip, for grouping
  tier text not null,                   -- 'free' | 'pro'
  endpoint text not null default 'check',
  claims_processed int not null default 0,
  llm_calls int not null default 0,     -- cost driver — billable unit
  status_code int not null,
  created_at timestamptz default now()
);
create index if not exists usage_logs_key_time_idx on public.usage_logs(api_key_id, created_at desc);
create index if not exists usage_logs_id_time_idx on public.usage_logs(identifier, created_at desc);

-- ── Corpus (multi-domain: legal statutes, FINRA/SEC rules, ...) ──────
create table if not exists public.corpus_chunks (
  id uuid primary key default gen_random_uuid(),
  domain text not null default 'legal_statute',  -- see lib/domains.ts DomainConfig keys
  source_name text not null,
  source_url text,
  content text not null,
  content_hash text not null,           -- sha256(source_url||content) for idempotent upsert
  embedding vector(768),
  updated_at timestamptz default now(),
  unique (content_hash)
);
create index if not exists corpus_embedding_idx on public.corpus_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists corpus_domain_idx on public.corpus_chunks(domain);

-- ── Checks (history + cross-user response cache) ────────────────────
-- Every check (all domains, all tiers, incl. anonymous) is persisted. Doubles
-- as a shared cache: an identical input_hash within the freshness window is
-- served from here with zero LLM/search cost. See lib/pipeline.ts + route.ts.
create table if not exists public.checks (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid references public.api_keys(id) on delete set null, -- null = anonymous
  domain text not null,
  input_text text not null,
  input_hash text not null,      -- sha256(normalized_text || domain || evidence_level)
  evidence_level text not null,  -- 'full' | 'limited' — separate cache namespaces per tier
  response jsonb not null,       -- full API response payload (claims, evidence, scores)
  overall_score real,
  created_at timestamptz default now()
);
create index if not exists checks_hash_idx on public.checks(input_hash, created_at desc); -- cache lookup
create index if not exists checks_key_idx  on public.checks(api_key_id, created_at desc); -- history

-- ── RLS ─────────────────────────────────────────────────────────────
alter table public.profiles     enable row level security;
alter table public.api_keys     enable row level security;
alter table public.usage_logs   enable row level security;
alter table public.checks       enable row level security;
-- corpus_chunks: RLS on, no policies — only the service-role client
-- (lib/db.ts getDb(), which bypasses RLS) ever queries this table; nothing
-- reads it via the anon key, so deny-all-by-default is correct here.
alter table public.corpus_chunks enable row level security;

-- profiles: owner read/write
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- api_keys: owner read only (writes go through service-role server routes)
drop policy if exists "own keys read" on public.api_keys;
create policy "own keys read" on public.api_keys
  for select using (auth.uid() = user_id);

-- usage_logs: owner read only (via join to api_keys)
drop policy if exists "own usage read" on public.usage_logs;
create policy "own usage read" on public.usage_logs
  for select using (
    api_key_id in (select id from public.api_keys where user_id = auth.uid())
  );

-- checks: owner read only (via join to api_keys). Writes + cache lookups go
-- through the service-role client (lib/db.ts getDb(), bypasses RLS). Anonymous
-- rows (null api_key_id) match no owner and are never exposed as history.
drop policy if exists "own checks read" on public.checks;
create policy "own checks read" on public.checks
  for select using (
    api_key_id in (select id from public.api_keys where user_id = auth.uid())
  );

-- ── Auto-create profile on signup ───────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Vector search RPC (domain-scoped — see lib/domains.ts) ───────────
create or replace function public.match_corpus(
  query_embedding vector(768),
  match_count int default 5,
  match_domain text default 'legal_statute'
)
returns table (content text, source_name text, source_url text, similarity float)
language sql stable as $$
  select content, source_name, source_url,
         1 - (embedding <=> query_embedding) as similarity
  from public.corpus_chunks
  where domain = match_domain
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- ── Response cache lookup ───────────────────────────────────────────
-- Returns the freshest cached response for an input_hash, but only if it's
-- younger than max_age_seconds. Keeps the freshness policy in one place; old
-- rows are retained for history (not deleted), just not served as cache.
create or replace function public.lookup_cached_check(
  p_input_hash text,
  p_max_age_seconds int
)
returns table (response jsonb, created_at timestamptz)
language sql stable as $$
  select response, created_at
  from public.checks
  where input_hash = p_input_hash
    and created_at > now() - make_interval(secs => p_max_age_seconds)
  order by created_at desc
  limit 1;
$$;

-- ── Monthly usage rollup for billing dashboard ──────────────────────
create or replace function public.usage_summary(p_user_id uuid)
returns table (period date, total_requests bigint, total_claims bigint, total_llm_calls bigint)
language sql stable security definer set search_path = public as $$
  select date_trunc('month', u.created_at)::date as period,
         count(*)                  as total_requests,
         sum(u.claims_processed)   as total_claims,
         sum(u.llm_calls)          as total_llm_calls
  from public.usage_logs u
  join public.api_keys k on k.id = u.api_key_id
  where k.user_id = p_user_id
  group by 1 order by 1 desc;
$$;

-- IMPORTANT after bulk corpus insert, run:  ANALYZE public.corpus_chunks;
-- (ivfflat needs stats to avoid sequential scans)
