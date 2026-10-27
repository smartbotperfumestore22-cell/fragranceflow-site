-- FragranceFlow · let a merchant edit its own store details from the portal (⚙️ إعدادات المتجر).
-- Only contact and branding fields; name, status, trial and subscription stay with FragranceFlow.
-- Paste in SQL Editor → Run. Safe to run again.
revoke update on public.stores from anon, authenticated;
grant update (city, website, whatsapp, instagram, logo_url, color) on public.stores to authenticated;

drop policy if exists stores_member_update on public.stores;
create policy stores_member_update on public.stores for update
  using (public.is_member(id)) with check (public.is_member(id));

-- links that are not https are not used anywhere (the site ignores them); clear them so the new check passes
update public.stores set instagram = '' where instagram <> '' and instagram !~ '^https://';
update public.stores set website = '' where website <> '' and website !~ '^https://';
update public.stores set whatsapp = regexp_replace(whatsapp, '[^0-9]', '', 'g') where whatsapp ~ '[^0-9]';

-- checks on new values (existing rows are left as they are)
alter table public.stores drop constraint if exists stores_links_ok;
alter table public.stores add constraint stores_links_ok check (
  (website = '' or website ~ '^https://') and (logo_url = '' or logo_url ~ '^https://')
  and (instagram = '' or instagram ~ '^https://') and (color = '' or color ~ '^#[0-9a-fA-F]{6}$')
  and whatsapp ~ '^[0-9]{0,15}$' and length(city) <= 60) not valid;
