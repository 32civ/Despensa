-- Migración para quien YA ejecutó los SQL anteriores: guarda la cantidad habitual por escaneo.
-- Ejecútala en Supabase → SQL Editor → New query → Run.
alter table public.items
  add column if not exists scan_qty numeric
  check (scan_qty is null or scan_qty > 0);
