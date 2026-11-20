-- Apply this migration in Supabase SQL Editor before using batch EXP corrections.
-- Audit rows intentionally have no foreign keys so they survive batch/material deletion.
create table if not exists public.material_batch_expiry_history (
  id uuid primary key default uuid_generate_v4(),
  batch_id uuid not null,
  material_id uuid not null,
  material_name text not null,
  old_expiry date not null,
  new_expiry date not null,
  changed_by text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists material_batch_expiry_history_batch_created_idx
  on public.material_batch_expiry_history (batch_id, created_at desc);

alter table public.material_batch_expiry_history enable row level security;

drop policy if exists "allow all material_batch_expiry_history"
  on public.material_batch_expiry_history;
drop policy if exists "read material_batch_expiry_history"
  on public.material_batch_expiry_history;
drop policy if exists "insert material_batch_expiry_history"
  on public.material_batch_expiry_history;
create policy "read material_batch_expiry_history"
  on public.material_batch_expiry_history
  for select using (true);
create policy "insert material_batch_expiry_history"
  on public.material_batch_expiry_history
  for insert with check (true);

revoke all on public.material_batch_expiry_history from anon, authenticated;
grant select, insert on public.material_batch_expiry_history to anon, authenticated;

create or replace function public.correct_material_batch_expiry(
  p_batch_id uuid,
  p_new_expiry date,
  p_reason text,
  p_changed_by text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old_expiry date;
  v_material_id uuid;
  v_material_name text;
  v_batch_stock numeric;
begin
  if p_new_expiry is null then
    raise exception 'Tanggal EXP baru wajib diisi.';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Alasan koreksi wajib diisi.';
  end if;
  if nullif(btrim(p_changed_by), '') is null then
    raise exception 'Nama operator wajib diisi.';
  end if;

  select batch.tanggal_expired, material.id, material.nama, batch.stok
    into v_old_expiry, v_material_id, v_material_name, v_batch_stock
    from public.material_batches as batch
    join public.raw_materials as material on material.id = batch.material_id
    where batch.id = p_batch_id
    for update of batch;

  if not found then
    raise exception 'Batch bahan baku tidak ditemukan.';
  end if;
  if v_batch_stock <= 0 then
    raise exception 'Stok batch sudah habis; koreksi tidak dapat mengubah stok.';
  end if;
  if v_old_expiry = p_new_expiry then
    raise exception 'Tanggal EXP tidak berubah.';
  end if;

  insert into public.material_batch_expiry_history (
    batch_id, material_id, material_name, old_expiry, new_expiry, changed_by, reason
  ) values (
    p_batch_id, v_material_id, v_material_name, v_old_expiry, p_new_expiry,
    btrim(p_changed_by), btrim(p_reason)
  );

  update public.material_batches
    set tanggal_expired = p_new_expiry
    where id = p_batch_id;
end;
$$;

grant execute on function public.correct_material_batch_expiry(uuid, date, text, text)
  to anon, authenticated;
