create extension if not exists "uuid-ossp";

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

alter table sales_events enable row level security;

drop policy if exists "allow all sales_events" on sales_events;
create policy "allow all sales_events"
  on sales_events
  for all
  using (true)
  with check (true);
