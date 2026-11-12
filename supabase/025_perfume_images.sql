-- RihaFlow · photos of the perfumes, uploaded by the team from the portal (الكاتالوگ › العطور › 📷).
-- Paste in SQL Editor → Run. Safe to run again.
--
-- One photo per perfume, shared by every store that sells it. The bucket is public, so the quiz shows the photos
-- without a login; only the RihaFlow team (admin or agent) can add, replace or remove them.
-- The portal shrinks each photo to WebP (600 px at most) before uploading: about 30–60 KB each.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('perfume-images', 'perfume-images', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists perfume_images_select on storage.objects;
create policy perfume_images_select on storage.objects for select to authenticated
  using (bucket_id = 'perfume-images' and public.is_admin());
drop policy if exists perfume_images_insert on storage.objects;
create policy perfume_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'perfume-images' and public.is_admin());
drop policy if exists perfume_images_update on storage.objects;
create policy perfume_images_update on storage.objects for update to authenticated
  using (bucket_id = 'perfume-images' and public.is_admin());
drop policy if exists perfume_images_delete on storage.objects;
create policy perfume_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'perfume-images' and public.is_admin());

-- check: how many active perfumes have a photo
select count(*) filter (where coalesce(image_url, '') ~ '^https://') as with_photo, count(*) as perfumes from public.perfumes where active;
