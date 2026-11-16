-- Kharait: persistent user-owned lesson maps (Supabase)
-- Run this file in Supabase SQL Editor after creating a project.
create extension if not exists pgcrypto;

create table if not exists public.lesson_maps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Carte sans titre',
  content jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lesson_maps_user_updated_idx
  on public.lesson_maps (user_id, updated_at desc);

alter table public.lesson_maps enable row level security;

drop policy if exists "Users can read their own maps" on public.lesson_maps;
create policy "Users can read their own maps"
  on public.lesson_maps for select using (auth.uid() = user_id);

drop policy if exists "Users can create their own maps" on public.lesson_maps;
create policy "Users can create their own maps"
  on public.lesson_maps for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own maps" on public.lesson_maps;
create policy "Users can update their own maps"
  on public.lesson_maps for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own maps" on public.lesson_maps;
create policy "Users can delete their own maps"
  on public.lesson_maps for delete using (auth.uid() = user_id);

create or replace function public.set_lesson_maps_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lesson_maps_updated_at on public.lesson_maps;
create trigger lesson_maps_updated_at
before update on public.lesson_maps
for each row execute function public.set_lesson_maps_updated_at();


-- Explicit least-privilege grants for authenticated users only.
grant usage on schema public to authenticated;
revoke all on table public.lesson_maps from anon;
grant select, insert, update, delete on table public.lesson_maps to authenticated;

-- Ask PostgREST (Supabase Data API) to refresh its schema cache.
notify pgrst, 'reload schema';
