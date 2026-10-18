-- Migración para quien YA ejecutó supabase-setup.sql: agrega la columna del código de barras.
-- Ejecútala en Supabase → SQL Editor → New query → Run.
alter table public.items
  add column if not exists barcode text
  check (barcode is null or barcode ~ '^[0-9]{6,14}$');
