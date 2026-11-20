create table if not exists public.daily_sales_forecasts (
  id uuid primary key default uuid_generate_v4(),
  target_date date not null,
  menu_key text not null,
  predicted numeric not null check (predicted >= 0),
  issued_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (target_date, menu_key)
);

alter table public.daily_sales_forecasts enable row level security;

drop policy if exists "read daily_sales_forecasts"
  on public.daily_sales_forecasts;
drop policy if exists "insert daily_sales_forecasts"
  on public.daily_sales_forecasts;
create policy "read daily_sales_forecasts"
  on public.daily_sales_forecasts
  for select using (true);
create policy "insert daily_sales_forecasts"
  on public.daily_sales_forecasts
  for insert with check (true);

revoke all on public.daily_sales_forecasts from anon, authenticated;
grant select, insert on public.daily_sales_forecasts to anon, authenticated;
