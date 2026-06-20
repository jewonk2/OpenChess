-- ===== OpenChess Supabase 설정 =====
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN 하세요.

-- 1) 계정 테이블 (직접 접근 차단, RPC로만 접근)
create table if not exists public.accounts (
  id text primary key,
  pw_hash text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
alter table public.accounts enable row level security;
-- 정책을 만들지 않음 → anon 키로는 이 테이블을 직접 읽거나 쓸 수 없음.
-- 아래 SECURITY DEFINER 함수를 통해서만 접근(비밀번호 해시는 절대 클라이언트로 반환 안 됨).

-- 2) 공유 콘텐츠 테이블 (개발자/공동개발자가 넣은 트리·분기·해설·키워드, 모든 방문자 공유)
create table if not exists public.app_content (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table public.app_content enable row level security;
create policy "content read"   on public.app_content for select using (true);
create policy "content insert" on public.app_content for insert with check (true);
create policy "content update" on public.app_content for update using (true) with check (true);

-- 3) 회원가입
create or replace function public.app_signup(p_id text, p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from accounts where id = p_id) then
    return jsonb_build_object('ok', false, 'error', 'exists');
  end if;
  insert into accounts(id, pw_hash, data) values (p_id, p_hash, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'data',
    jsonb_build_object('id', p_id, 'progress', '{}'::jsonb, 'chesscom', ''));
end; $$;

-- 4) 로그인 (해시 일치 시에만 data 반환, pw_hash 는 반환하지 않음)
create or replace function public.app_login(p_id text, p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r accounts;
begin
  select * into r from accounts where id = p_id;
  if not found or r.pw_hash <> p_hash then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', r.id,
    'progress', coalesce(r.data->'progress', '{}'::jsonb),
    'chesscom', coalesce(r.data->>'chesscom', '')
  ));
end; $$;

-- 5) 진도/연동 저장 (비밀번호 해시가 일치해야만 저장)
create or replace function public.app_save(p_id text, p_hash text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update accounts set data = p_data where id = p_id and pw_hash = p_hash;
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true);
end; $$;

-- 6) anon 키에 RPC 실행 권한 부여
grant execute on function public.app_signup(text, text)        to anon, authenticated;
grant execute on function public.app_login(text, text)         to anon, authenticated;
grant execute on function public.app_save(text, text, jsonb)   to anon, authenticated;
