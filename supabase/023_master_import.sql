-- RihaFlow · prepare the perfumes table for the master database (FragranceFlow_Master_Final).
-- Paste in SQL Editor → Run ONCE, before the data files (023a, 023b…). Safe to run again.
--
-- 1) master_id: the perfume's id in the master file (PFM-000123), so the file and the portal stay linked.
--    The portal keeps its own ids (FF-0001…): offers, reviews and statistics point to them.
-- 2) strength: light / moderate / strong, from the master file. Stored only: the quiz does not use it yet.
alter table public.perfumes add column if not exists master_id text;
alter table public.perfumes add column if not exists strength text not null default '';
create unique index if not exists perfumes_master_id_key on public.perfumes (master_id) where master_id is not null;
alter table public.perfumes drop constraint if exists perfumes_strength_ok;
alter table public.perfumes add constraint perfumes_strength_ok check (strength in ('', 'light', 'moderate', 'strong')) not valid;
create index if not exists offers_perfume_id_idx on public.offers (perfume_id);

-- 3) who may read the perfumes. Before: any visitor could list every active perfume through the API,
--    which would hand out the whole master database. Now:
--    · visitors (not signed in): only the perfumes a live store sells (what the quiz needs, nothing more);
--    · signed-in merchants: every active perfume (to search the catalogue and match their list);
--    · the RihaFlow team: everything.
drop policy if exists perfumes_read on public.perfumes;
create policy perfumes_read on public.perfumes for select using (
  public.is_admin()
  or (active and auth.uid() is not null)
  or (active and exists (select 1 from public.offers o
                         where o.perfume_id = perfumes.perfume_id and o.active and public.store_is_live(o.store_id))));

-- check
select count(*) as perfumes, count(master_id) as linked_to_master from public.perfumes;
