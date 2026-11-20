alter table promotions add column if not exists source text not null default 'manual';
alter table promotions add column if not exists batch_id uuid null
  references raw_materials(id) on delete set null;
alter table promotions add column if not exists ingredient_name text null;
alter table promotions add column if not exists surplus_units_est numeric null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'promotions_source_check') then
    alter table promotions add constraint promotions_source_check
      check (source in ('manual','fefo'));
  end if;
end $$;
