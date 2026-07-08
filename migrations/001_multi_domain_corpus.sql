-- Adds multi-domain support to an already-deployed corpus_chunks table.
-- Run once in Supabase SQL Editor against an existing project (schema.sql
-- already reflects this for fresh installs — this file is for upgrading).

alter table public.corpus_chunks
  add column if not exists domain text not null default 'legal_statute';

create index if not exists corpus_domain_idx on public.corpus_chunks(domain);

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
