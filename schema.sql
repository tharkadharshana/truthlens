-- TruthLens schema. Run in Supabase SQL editor.
-- Fixes vs v1: keys are HASHED (never plaintext), usage_logs added for billing,
-- match_corpus RPC + ANALYZE guidance, ownership-safe RLS.

create extension if not exists vector;
create extension if not exists pgcrypto;  -- for digest()

-- ── Profiles (public mirror of auth.users) ──────────────────────────
create table if not exists public.profiles (
  id uuid references auth.users primary key,
  email text not null,
  created_at timestamptz default now()
);

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

-- ── Legal corpus ────────────────────────────────────────────────────
create table if not exists public.corpus_chunks (
  id uuid primary key default gen_random_uuid(),
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

-- ── RLS ─────────────────────────────────────────────────────────────
alter table public.profiles    enable row level security;
alter table public.api_keys    enable row level security;
alter table public.usage_logs  enable row level security;

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

-- ── Vector search RPC ───────────────────────────────────────────────
create or replace function public.match_corpus(
  query_embedding vector(768),
  match_count int default 5
)
returns table (content text, source_name text, source_url text, similarity float)
language sql stable as $$
  select content, source_name, source_url,
         1 - (embedding <=> query_embedding) as similarity
  from public.corpus_chunks
  order by embedding <=> query_embedding
  limit match_count;
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
