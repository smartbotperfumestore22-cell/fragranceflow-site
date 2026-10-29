-- FragranceFlow · the store's own quiz page: welcome title and text, cover picture, and pictures uploaded from the portal.
-- Paste in SQL Editor → Run. Safe to run again.

-- 1) welcome text and cover picture of the store's quiz page
alter table public.stores add column if not exists welcome_title text not null default '';
alter table public.stores add column if not exists welcome_text  text not null default '';
alter table public.stores add column if not exists cover_url     text not null default '';
alter table public.stores drop constraint if exists stores_page_ok;
alter table public.stores add constraint stores_page_ok check (
  length(welcome_title) <= 80 and length(welcome_text) <= 300 and (cover_url = '' or cover_url ~ '^https://')) not valid;
-- the merchant may change these too (next to the contact fields of 004)
grant update (city, website, whatsapp, instagram, logo_url, color, welcome_title, welcome_text, cover_url) on public.stores to authenticated;

-- 2) pictures (logo, cover) uploaded from the portal: a public folder per store, at most 2 MB, images only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-assets', 'store-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- a merchant writes only in its own store's folder (store-assets/<store_id>/…); the team everywhere
-- (the pictures themselves are public: the bucket is public, so the quiz page shows them without a login)
drop policy if exists store_assets_select on storage.objects;
create policy store_assets_select on storage.objects for select to authenticated
  using (bucket_id = 'store-assets' and (public.is_member((storage.foldername(name))[1]) or public.is_admin()));
drop policy if exists store_assets_insert on storage.objects;
create policy store_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'store-assets' and (public.is_member((storage.foldername(name))[1]) or public.is_admin()));
drop policy if exists store_assets_update on storage.objects;
create policy store_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'store-assets' and (public.is_member((storage.foldername(name))[1]) or public.is_admin()));
drop policy if exists store_assets_delete on storage.objects;
create policy store_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'store-assets' and (public.is_member((storage.foldername(name))[1]) or public.is_admin()));
