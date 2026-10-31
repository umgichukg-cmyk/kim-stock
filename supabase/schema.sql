-- 김가네 주식: 관심 종목과 종목 메모
-- Supabase 대시보드 → SQL Editor에 붙여 넣고 Run. 여러 번 실행해도 괜찮아요.
-- 보안 규칙(RLS): 로그인한 사람은 자기 관심 종목과 메모만 보고, 넣고, 고치고, 지울 수 있어요.

create table if not exists public.watchlist (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code text not null check (code ~ '^[0-9A-Z]{6}$'),
  name text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, code)
);

create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code text not null check (code ~ '^[0-9A-Z]{6}$'),
  name text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memos_user_code on public.memos (user_id, code, created_at desc);

-- 메모를 고치면 수정 시각 자동 갱신
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists memos_touch on public.memos;
create trigger memos_touch before update on public.memos
  for each row execute function public.touch_updated_at();

alter table public.watchlist enable row level security;
alter table public.memos enable row level security;

drop policy if exists "본인 관심 종목만" on public.watchlist;
create policy "본인 관심 종목만" on public.watchlist for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "본인 메모만" on public.memos;
create policy "본인 메모만" on public.memos for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 로그인하지 않은 사용자(anon)는 아무것도 못 하게
revoke all on public.watchlist, public.memos from anon;
grant select, insert, update, delete on public.watchlist, public.memos to authenticated;
