alter table menu_catalog add column if not exists image_url text;
alter table menu_catalog add column if not exists image_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 1048576,
        array['image/webp','image/jpeg','image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "menu images read" on storage.objects;
create policy "menu images read" on storage.objects
  for select using (bucket_id = 'menu-images');
drop policy if exists "menu images insert" on storage.objects;
create policy "menu images insert" on storage.objects
  for insert with check (bucket_id = 'menu-images');
drop policy if exists "menu images update" on storage.objects;
create policy "menu images update" on storage.objects
  for update using (bucket_id = 'menu-images') with check (bucket_id = 'menu-images');
drop policy if exists "menu images delete" on storage.objects;
create policy "menu images delete" on storage.objects
  for delete using (bucket_id = 'menu-images');

-- Kebijakan ini permisif (sama seperti tabel lain) dan bucket bersifat publik.
-- Jangan unggah foto sensitif.
