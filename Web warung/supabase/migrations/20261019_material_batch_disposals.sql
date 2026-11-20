-- Apply after 20261019_material_batch_expiry_corrections.sql.
-- Disposal history is append-only for application roles and survives batch deletion.
create table if not exists public.material_batch_disposal_history (
  id uuid primary key default uuid_generate_v4(),
  batch_id uuid not null,
  material_id uuid not null,
  material_name text not null,
  batch_expiry date not null,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  unit_cost numeric not null check (unit_cost >= 0),
  total_loss numeric not null check (total_loss >= 0),
  changed_by text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists material_batch_disposal_history_created_idx
  on public.material_batch_disposal_history (created_at desc);
create index if not exists material_batch_disposal_history_batch_idx
  on public.material_batch_disposal_history (batch_id, created_at desc);

alter table public.material_batch_disposal_history enable row level security;

drop policy if exists "read material_batch_disposal_history"
  on public.material_batch_disposal_history;
drop policy if exists "insert material_batch_disposal_history"
  on public.material_batch_disposal_history;
create policy "read material_batch_disposal_history"
  on public.material_batch_disposal_history
  for select using (true);
create policy "insert material_batch_disposal_history"
  on public.material_batch_disposal_history
  for insert with check (true);

revoke all on public.material_batch_disposal_history from anon, authenticated;
grant select, insert on public.material_batch_disposal_history to anon, authenticated;

create or replace function public.dispose_expired_material_batch(
  p_batch_id uuid,
  p_quantity numeric,
  p_changed_by text,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_material_id uuid;
  v_material_name text;
  v_batch_expiry date;
  v_batch_stock numeric;
  v_unit text;
  v_unit_cost numeric;
  v_remaining_stock numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Jumlah pembuangan harus lebih dari 0.';
  end if;
  if nullif(btrim(p_changed_by), '') is null then
    raise exception 'Nama operator wajib diisi.';
  end if;
  if length(btrim(p_changed_by)) > 80 then
    raise exception 'Nama operator maksimal 80 karakter.';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Alasan pembuangan wajib diisi.';
  end if;
  if length(btrim(p_reason)) > 300 then
    raise exception 'Alasan pembuangan maksimal 300 karakter.';
  end if;

  select batch.material_id, material.nama, batch.tanggal_expired, batch.stok,
         material.satuan, batch.harga
    into v_material_id, v_material_name, v_batch_expiry, v_batch_stock,
         v_unit, v_unit_cost
    from public.material_batches as batch
    join public.raw_materials as material on material.id = batch.material_id
    where batch.id = p_batch_id
    for update of batch;

  if not found then
    raise exception 'Batch bahan baku tidak ditemukan.';
  end if;
  if v_batch_expiry > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Batch belum kedaluwarsa dan tidak dapat dibuang.';
  end if;
  if v_batch_stock <= 0 then
    raise exception 'Stok batch sudah habis.';
  end if;
  if p_quantity > v_batch_stock then
    raise exception 'Jumlah pembuangan melebihi stok batch yang tersisa.';
  end if;

  v_remaining_stock := v_batch_stock - p_quantity;

  insert into public.material_batch_disposal_history (
    batch_id, material_id, material_name, batch_expiry, quantity, unit,
    unit_cost, total_loss, changed_by, reason
  ) values (
    p_batch_id, v_material_id, v_material_name, v_batch_expiry, p_quantity,
    v_unit, v_unit_cost, p_quantity * v_unit_cost, btrim(p_changed_by),
    btrim(p_reason)
  );

  update public.material_batches
    set stok = v_remaining_stock
    where id = p_batch_id;

  update public.raw_materials
    set stok = (
      select coalesce(sum(batch.stok), 0)
      from public.material_batches as batch
      where batch.material_id = v_material_id
    )
    where id = v_material_id;
end;
$$;

grant execute on function public.dispose_expired_material_batch(uuid, numeric, text, text)
  to anon, authenticated;

create or replace function public.get_material_batch_disposal_loss()
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(total_loss), 0)
  from public.material_batch_disposal_history;
$$;

grant execute on function public.get_material_batch_disposal_loss()
  to anon, authenticated;
