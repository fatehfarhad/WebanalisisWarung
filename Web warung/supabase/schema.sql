-- =========================================================
-- ForecastBiz AI — Skema Database Supabase (PostgreSQL)
-- Jalankan file ini di Supabase Dashboard > SQL Editor
-- =========================================================

create extension if not exists "uuid-ossp";

-- 1. Katalog Menu
create table if not exists menu_catalog (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text not null default 'Makanan',
  price numeric not null default 0,
  cost numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2. Resep per Menu (bahan baku + takaran per porsi)
create table if not exists menu_recipes (
  id uuid primary key default uuid_generate_v4(),
  menu_id uuid not null references menu_catalog(id) on delete cascade,
  material_name text not null,
  amount numeric not null,
  unit text not null
);

-- 3. Bahan Baku Mentah
create table if not exists raw_materials (
  id uuid primary key default uuid_generate_v4(),
  nama text not null,
  stok numeric not null default 0,
  satuan text not null,
  harga numeric not null default 0,
  batas_rop numeric not null default 0,
  daya_tahan_hari integer not null default 1,
  tanggal_input date not null default current_date,
  tanggal_expired date not null,
  created_at timestamptz not null default now()
);

-- 3b. Batch stok bahan baku
-- Satu bahan dapat memiliki banyak batch dengan harga dan kedaluwarsa berbeda.
create table if not exists material_batches (
  id uuid primary key default uuid_generate_v4(),
  material_id uuid not null references raw_materials(id) on delete cascade,
  stok numeric not null default 0,
  harga numeric not null default 0,
  tanggal_input date not null default current_date,
  tanggal_expired date not null,
  created_at timestamptz not null default now()
);

-- 4. Riwayat Harga Bahan Baku (untuk grafik tren harga)
create table if not exists material_price_history (
  id uuid primary key default uuid_generate_v4(),
  material_id uuid not null references raw_materials(id) on delete cascade,
  label text not null,
  price numeric not null,
  recorded_at timestamptz not null default now()
);

-- 5. Struk Transaksi (header)
create table if not exists receipts (
  id uuid primary key default uuid_generate_v4(),
  receipt_no text not null,
  tanggal date not null default current_date,
  waktu text not null,
  total numeric not null default 0,
  profit numeric not null default 0,
  created_at timestamptz not null default now()
);

-- 6. Item per Struk
create table if not exists receipt_items (
  id uuid primary key default uuid_generate_v4(),
  receipt_id uuid not null references receipts(id) on delete cascade,
  menu_id uuid references menu_catalog(id),
  name text not null,
  qty integer not null,
  price numeric not null,
  subtotal numeric not null,
  profit numeric not null
);

-- 7. Snapshot harian dashboard
create table if not exists dashboard_daily_snapshots (
  id uuid primary key default uuid_generate_v4(),
  snapshot_date date not null unique,
  sales numeric not null default 0,
  profit numeric not null default 0,
  procurement_estimate numeric not null default 0,
  expired_loss numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 8. Ramalan penjualan harian yang disimpan saat diterbitkan
create table if not exists daily_sales_forecasts (
  id uuid primary key default uuid_generate_v4(),
  target_date date not null,
  menu_key text not null,
  predicted numeric not null check (predicted >= 0),
  issued_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (target_date, menu_key)
);

-- 9. Catatan kejadian yang memengaruhi penjualan
create table if not exists sales_events (
  id uuid primary key default uuid_generate_v4(),
  tanggal date not null,
  menu_id uuid references menu_catalog(id),
  predicted numeric not null,
  actual numeric not null,
  deviation_pct numeric not null,
  category text not null,
  note text,
  is_recurring boolean not null default false,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Row Level Security
-- Catatan: kebijakan di bawah ini PERMISIF (semua orang dengan
-- anon key boleh baca/tulis). Ini cocok untuk 1 toko/1 pemilik
-- yang mengakses lewat 1 halaman internal. Jika nanti aplikasi
-- dipakai multi-toko / publik, GANTI kebijakan ini dengan
-- pengecekan auth.uid() sesuai kebutuhan Anda.
-- =========================================================
alter table menu_catalog enable row level security;
alter table menu_recipes enable row level security;
alter table raw_materials enable row level security;
alter table material_batches enable row level security;
alter table material_price_history enable row level security;
alter table receipts enable row level security;
alter table receipt_items enable row level security;
alter table dashboard_daily_snapshots enable row level security;
alter table daily_sales_forecasts enable row level security;
alter table sales_events enable row level security;

drop policy if exists "allow all menu_catalog" on menu_catalog;
drop policy if exists "allow all menu_recipes" on menu_recipes;
drop policy if exists "allow all raw_materials" on raw_materials;
drop policy if exists "allow all material_batches" on material_batches;
drop policy if exists "allow all material_price_history" on material_price_history;
drop policy if exists "allow all receipts" on receipts;
drop policy if exists "allow all receipt_items" on receipt_items;
drop policy if exists "allow all dashboard_daily_snapshots" on dashboard_daily_snapshots;
drop policy if exists "allow all sales_events" on sales_events;
drop policy if exists "read daily_sales_forecasts" on daily_sales_forecasts;
drop policy if exists "insert daily_sales_forecasts" on daily_sales_forecasts;

create policy "allow all menu_catalog" on menu_catalog for all using (true) with check (true);
create policy "allow all menu_recipes" on menu_recipes for all using (true) with check (true);
create policy "allow all raw_materials" on raw_materials for all using (true) with check (true);
create policy "allow all material_batches" on material_batches for all using (true) with check (true);
create policy "allow all material_price_history" on material_price_history for all using (true) with check (true);
create policy "allow all receipts" on receipts for all using (true) with check (true);
create policy "allow all receipt_items" on receipt_items for all using (true) with check (true);
create policy "allow all dashboard_daily_snapshots" on dashboard_daily_snapshots for all using (true) with check (true);
create policy "allow all sales_events" on sales_events for all using (true) with check (true);
create policy "read daily_sales_forecasts" on daily_sales_forecasts for select using (true);
create policy "insert daily_sales_forecasts" on daily_sales_forecasts for insert with check (true);
revoke all on daily_sales_forecasts from anon, authenticated;
grant select, insert on daily_sales_forecasts to anon, authenticated;

-- =========================================================
-- Data Contoh (opsional) — sama seperti versi demo sebelumnya
-- Hapus bagian ini jika tidak ingin data contoh ikut masuk.
-- =========================================================
with new_menu as (
  insert into menu_catalog (name, category, price, cost, active) values
   ('Ayam Geprek Sambal Matah','Makanan',18000,10000,true),
   ('Udang Crispy + Nasi','Makanan',25000,14000,true),
   ('Gurami Bakar','Makanan',45000,28000,true),
   ('Kopi Susu Gula Aren','Minuman',15000,7000,true)
  returning id, name
)
insert into menu_recipes (menu_id, material_name, amount, unit)
select id,
  case name
    when 'Ayam Geprek Sambal Matah' then 'Daging Ayam Fillet'
    when 'Udang Crispy + Nasi' then 'Udang Segar'
    when 'Gurami Bakar' then 'Ikan Gurami'
    when 'Kopi Susu Gula Aren' then 'Susu UHT Fresh'
  end,
  case name
    when 'Ayam Geprek Sambal Matah' then 150
    when 'Udang Crispy + Nasi' then 120
    when 'Gurami Bakar' then 300
    when 'Kopi Susu Gula Aren' then 200
  end,
  case name
    when 'Kopi Susu Gula Aren' then 'ml'
    else 'gram'
  end
from new_menu;

insert into raw_materials (nama, stok, satuan, harga, batas_rop, daya_tahan_hari, tanggal_input, tanggal_expired) values
 ('Daging Ayam Fillet', 4, 'kg', 35000, 10, 3, (current_date - interval '1 day')::date, (current_date + interval '2 day')::date),
 ('Udang Segar', 3, 'kg', 65000, 8, 2, current_date, (current_date + interval '2 day')::date),
 ('Ikan Gurami', 12, 'kg', 40000, 5, 4, (current_date - interval '1 day')::date, (current_date + interval '3 day')::date),
 ('Susu UHT Fresh', 15, 'liter', 18000, 10, 7, (current_date - interval '1 day')::date, (current_date + interval '6 day')::date);

-- Migrasi data lama: setiap bahan lama menjadi batch awal satu kali.
insert into material_batches (material_id, stok, harga, tanggal_input, tanggal_expired)
select id, stok, harga, tanggal_input, tanggal_expired
from raw_materials material
where not exists (
  select 1 from material_batches batch where batch.material_id = material.id
);

with rm as (select id, nama, harga from raw_materials)
insert into material_price_history (material_id, label, price)
select id, 'Awal', harga from rm;
