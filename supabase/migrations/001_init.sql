-- Saved chats and saved paid evidence (optional sign-in). Run once in the Supabase SQL editor.
-- Every table has Row Level Security: a row is readable and writable only by its owner (auth.uid() = user_id).
-- The anon role gets nothing. Deleting a user's chat sessions removes their messages (cascade); deleting the
-- auth user removes everything they own.

create table public.chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'New chat' check (char_length(title) <= 120),
  model       text check (model is null or char_length(model) <= 80),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.chat_sessions (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('user', 'agent')),
  text        text not null check (char_length(text) between 1 and 4000),
  steps       jsonb check (steps is null or octet_length(steps::text) <= 200000),
  created_at  timestamptz not null default now()
);

create table public.paid_evidence (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  asset_code     text not null check (asset_code ~ '^[A-Za-z0-9]{1,12}$'),
  issuer         text not null check (issuer ~ '^G[A-Z2-7]{55}$'),
  bundle         jsonb not null check (octet_length(bundle::text) <= 1000000),
  settlement_tx  text not null check (char_length(settlement_tx) between 1 and 128),
  paid_at        timestamptz not null default now(),
  unique (user_id, asset_code, issuer, settlement_tx)
);

create index chat_sessions_user_updated on public.chat_sessions (user_id, updated_at desc);
create index chat_messages_session_created on public.chat_messages (session_id, created_at);
create index paid_evidence_user_asset on public.paid_evidence (user_id, asset_code, issuer);

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.paid_evidence enable row level security;

revoke all on public.chat_sessions, public.chat_messages, public.paid_evidence from anon;
-- Newer Supabase projects do not grant Data API access to tables by default, so say it explicitly. RLS still limits every row.
grant select, insert, update, delete on public.chat_sessions to authenticated;
grant select, insert, delete on public.chat_messages, public.paid_evidence to authenticated;

-- chat_sessions
create policy "own sessions: read" on public.chat_sessions for select to authenticated using (auth.uid() = user_id);
create policy "own sessions: insert" on public.chat_sessions for insert to authenticated with check (auth.uid() = user_id);
create policy "own sessions: update" on public.chat_sessions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own sessions: delete" on public.chat_sessions for delete to authenticated using (auth.uid() = user_id);

-- chat_messages: a message may only be added to a session the same user owns.
create policy "own messages: read" on public.chat_messages for select to authenticated using (auth.uid() = user_id);
create policy "own messages: insert" on public.chat_messages for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = auth.uid())
  );
create policy "own messages: delete" on public.chat_messages for delete to authenticated using (auth.uid() = user_id);

-- paid_evidence
create policy "own evidence: read" on public.paid_evidence for select to authenticated using (auth.uid() = user_id);
create policy "own evidence: insert" on public.paid_evidence for insert to authenticated with check (auth.uid() = user_id);
create policy "own evidence: delete" on public.paid_evidence for delete to authenticated using (auth.uid() = user_id);

-- Per-user row caps, so one account cannot fill the database through the REST API.
create or replace function public.cap_rows() returns trigger language plpgsql security invoker as $$
declare
  limit_rows int := tg_argv[0]::int;
  current_rows int;
begin
  execute format('select count(*) from %I.%I where user_id = $1', tg_table_schema, tg_table_name) into current_rows using new.user_id;
  if current_rows >= limit_rows then
    raise exception 'Row limit reached for %', tg_table_name using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger cap_chat_sessions before insert on public.chat_sessions for each row execute function public.cap_rows(200);
create trigger cap_chat_messages before insert on public.chat_messages for each row execute function public.cap_rows(5000);
create trigger cap_paid_evidence before insert on public.paid_evidence for each row execute function public.cap_rows(200);
