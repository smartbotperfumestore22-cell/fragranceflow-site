-- RihaFlow · the store's opinion on its perfumes (first version).
-- Paste in SQL Editor → Run (after 013). Safe to run again.
--
-- The merchant is never asked to rate the whole catalogue: the portal shows one or two perfumes at a time,
-- picked by review_queue (the ones customers see most, never reviewed first). Two questions, both optional:
--   sales      how it sells in this store: 3 = a lot, 2 = normal, 1 = little, 0 = not sure
--   longevity  how long it lasts for the store's customers: 4 = very strong, 3 = strong, 2 = medium, 1 = weak, 0 = not sure
-- A store's opinion stays with that store: it never changes the shared perfume data, other stores never see it,
-- and in this version it does not change the ranking of the quiz.

create table if not exists public.store_reviews (
  store_id    text not null references public.stores (id) on delete cascade,
  perfume_id  text not null references public.perfumes (perfume_id) on update cascade on delete cascade,
  sales       smallint check (sales between 0 and 3),
  longevity   smallint check (longevity between 0 and 4),
  reviewed_at timestamptz,          -- last time an answer was saved
  skipped_at  timestamptz,          -- «من بعد»: not asked again for a few days
  updated_at  timestamptz not null default now(),
  primary key (store_id, perfume_id)
);

alter table public.store_reviews enable row level security;
drop policy if exists store_reviews_read on public.store_reviews;
create policy store_reviews_read on public.store_reviews for select to authenticated using (public.is_member(store_id) or public.is_admin());
drop policy if exists store_reviews_insert on public.store_reviews;
create policy store_reviews_insert on public.store_reviews for insert to authenticated with check (public.is_member(store_id) or public.is_admin());
drop policy if exists store_reviews_update on public.store_reviews;
create policy store_reviews_update on public.store_reviews for update to authenticated using (public.is_member(store_id) or public.is_admin()) with check (public.is_member(store_id) or public.is_admin());
revoke all on public.store_reviews from anon;
grant select, insert, update on public.store_reviews to authenticated;

-- save an answer (or «من بعد» when both are null and p_skip is true); upper-case id like the rest of the catalogue
create or replace function public.save_store_review(p_store text, p_perfume text, p_sales smallint default null, p_longevity smallint default null, p_skip boolean default false)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  if not (public.is_member(p_store) or public.is_admin()) then return false; end if;
  if p_skip then
    insert into store_reviews (store_id, perfume_id, skipped_at, updated_at) values (p_store, upper(p_perfume), now(), now())
    on conflict (store_id, perfume_id) do update set skipped_at = now(), updated_at = now();
  else
    if p_sales is null and p_longevity is null then return false; end if;
    insert into store_reviews (store_id, perfume_id, sales, longevity, reviewed_at, skipped_at, updated_at)
    values (p_store, upper(p_perfume), p_sales, p_longevity, now(), null, now())
    on conflict (store_id, perfume_id) do update set
      sales = coalesce(excluded.sales, store_reviews.sales), longevity = coalesce(excluded.longevity, store_reviews.longevity),
      reviewed_at = now(), skipped_at = null, updated_at = now();
  end if;
  return true;
end $$;
revoke all on function public.save_store_review(text, text, smallint, smallint, boolean) from public, anon;
grant execute on function public.save_store_review(text, text, smallint, smallint, boolean) to authenticated;

-- the store's perfumes with how often customers saw them (last 30 days) and the store's opinion, for the queue and the tab
create or replace function public.store_review_list(p_store text)
returns table (perfume_id text, name text, brand text, image text, shown int, whatsapp int, sales smallint, longevity smallint, reviewed_at timestamptz, skipped_at timestamptz)
-- definer: the daily numbers are not readable directly; the membership check below keeps each store to its own data
language sql stable security definer set search_path = public as $$
  with mine as (
    select distinct upper(o.perfume_id) pid from offers o where o.store_id = p_store and o.active
      and (public.is_member(p_store) or public.is_admin())
  ),
  seen as (
    select upper(dimension) pid, sum(value) filter (where metric = 'perfume')::int shown, sum(value) filter (where metric = 'whatsapp_perfume')::int wa
    from daily_stats where store_id = p_store and metric in ('perfume', 'whatsapp_perfume')
      and day >= (now() at time zone 'Africa/Casablanca')::date - 30
    group by 1
  )
  select f.perfume_id, f.name, f.brand, case when f.image_url ~ '^https://' then f.image_url else '' end,
         coalesce(s.shown, 0), coalesce(s.wa, 0), r.sales, r.longevity, r.reviewed_at, r.skipped_at
  from mine m join perfumes f on upper(f.perfume_id) = m.pid
  left join seen s on s.pid = m.pid
  left join store_reviews r on r.store_id = p_store and upper(r.perfume_id) = m.pid
$$;
revoke all on function public.store_review_list(text) from public, anon;
grant execute on function public.store_review_list(text) to authenticated;

-- one or two perfumes to ask about now:
--  1st: the one customers see most among those never reviewed (then reviews older than 6 months)
--  2nd: a never-reviewed perfume picked at random, so the ones customers see less also get an opinion
-- never a perfume reviewed in the last 6 months, nor one put off («من بعد») in the last 3 days
create or replace function public.review_queue(p_store text, p_n int default 2)
returns table (perfume_id text, name text, brand text, image text, shown int, whatsapp int, sales smallint, longevity smallint, reviewed_at timestamptz)
language sql volatile security invoker set search_path = public as $$
  with l as (
    select * from public.store_review_list(p_store) x
    where (x.skipped_at is null or x.skipped_at < now() - interval '3 days')
      and (x.reviewed_at is null or x.reviewed_at < now() - interval '180 days')
  ),
  q1 as (
    select * from l order by (l.reviewed_at is not null), l.shown + 3 * l.whatsapp desc, l.name limit 1
  ),
  q2 as (
    select * from l where l.reviewed_at is null and l.perfume_id not in (select f.perfume_id from q1 f) order by random() limit 1
  )
  select perfume_id, name, brand, image, shown, whatsapp, sales, longevity, reviewed_at from (
    select 1 k, * from q1 union all select 2, * from q2
  ) q where k <= greatest(1, least(coalesce(p_n, 2), 2)) order by k
$$;
revoke all on function public.review_queue(text, int) from public, anon;
grant execute on function public.review_queue(text, int) to authenticated;
