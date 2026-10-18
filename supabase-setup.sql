-- Ejecuta TODO este archivo en Supabase → SQL Editor → New query → Run.

-- 1) Tablas -------------------------------------------------------------
create table if not exists public.items (
  household_id text   not null check (char_length(household_id) >= 32),
  id           text   not null,
  name         text   not null check (char_length(name) between 1 and 80),
  emoji        text   not null default '🛒',
  zone         text   not null,
  qty          numeric not null check (qty >= 0),
  unit         text   not null,
  par          numeric not null default 1 check (par >= 0),
  sort_order   bigint not null default 0,
  barcode      text   check (barcode is null or barcode ~ '^[0-9]{6,14}$'),
  scan_qty     numeric check (scan_qty is null or scan_qty > 0),
  updated_at   timestamptz not null default now(),
  primary key (household_id, id)
);

create table if not exists public.members (
  user_id      uuid not null references auth.users(id) on delete cascade,
  household_id text not null check (char_length(household_id) >= 32),
  primary key (user_id, household_id)
);

-- 2) Seguridad por filas (RLS) --------------------------------------------
-- Solo ves y editas los productos de las casas a las que te uniste con el código.
alter table public.items   enable row level security;
alter table public.members enable row level security;

drop policy if exists "ver mis membresias" on public.members;
create policy "ver mis membresias" on public.members
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "items de mis casas" on public.items;
create policy "items de mis casas" on public.items
  for all to authenticated
  using (exists (select 1 from public.members m
                 where m.user_id = (select auth.uid()) and m.household_id = items.household_id))
  with check (exists (select 1 from public.members m
                 where m.user_id = (select auth.uid()) and m.household_id = items.household_id));

-- 3) Unirse a una casa con su código (única forma de crear una membresía) -----
create or replace function public.join_household(code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or char_length(code) < 32 then
    raise exception 'codigo invalido';
  end if;
  insert into public.members (user_id, household_id) values (auth.uid(), code)
  on conflict do nothing;
end;
$$;
revoke execute on function public.join_household(text) from public, anon;
grant  execute on function public.join_household(text) to authenticated;

-- 4) Permisos explícitos para la Data API (obligatorios en proyectos nuevos) ---
grant select, insert, update, delete on public.items   to authenticated;
grant select                         on public.members to authenticated;

-- 5) Tiempo real ----------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.items;
exception when duplicate_object then null;
end $$;
