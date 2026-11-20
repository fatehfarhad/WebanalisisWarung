alter table menu_catalog
  add column if not exists other_cost numeric not null default 0;
