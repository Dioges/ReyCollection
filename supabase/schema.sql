create table if not exists public.collections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  games jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.collections enable row level security;
revoke all on table public.collections from anon;
grant select, insert, update, delete on table public.collections to authenticated;

drop policy if exists "Users manage their own collection" on public.collections;
create policy "Users manage their own collection"
  on public.collections
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
