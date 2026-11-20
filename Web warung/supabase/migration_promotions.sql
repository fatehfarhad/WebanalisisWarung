create extension if not exists "uuid-ossp";

create table if not exists promotions (
  id uuid primary key default uuid_generate_v4(),
  menu_id uuid not null references menu_catalog(id) on delete cascade,
  promo_price numeric not null check (promo_price > 0),
  normal_price numeric not null check (normal_price > 0),
  start_date date not null,
  end_date date not null,
  weekdays smallint[],
  stopped_on date,
  result_status text not null default 'pending'
    check (result_status in ('pending', 'recorded', 'insufficient')),
  result_note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (
    weekdays is null or (
      array_length(weekdays, 1) between 1 and 7
      and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
    )
  )
);

alter table promotions
  add column if not exists weekdays smallint[],
  add column if not exists stopped_on date,
  add column if not exists result_status text not null default 'pending',
  add column if not exists result_note text;

alter table receipt_items
  add column if not exists promo_id uuid
    references promotions(id) on delete set null,
  add column if not exists normal_price numeric;

alter table sales_events
  add column if not exists discount_pct numeric,
  add column if not exists promo_id uuid
    references promotions(id) on delete set null;

create unique index if not exists sales_events_promo_id_key
  on sales_events (promo_id)
  where promo_id is not null;

alter table promotions enable row level security;
drop policy if exists "allow all promotions" on promotions;
create policy "allow all promotions"
  on promotions
  for all
  using (true)
  with check (true);
