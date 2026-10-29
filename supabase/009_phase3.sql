-- FragranceFlow · Phase 3: Supabase is the only source. Paste in SQL Editor → Run. Safe to run again.

-- 1) "most looked-for" perfumes (homepage order), from the events of the last N days, same weights as the old Sheet version
create or replace function public.popular_items(p_days int default 30) returns jsonb
language sql stable security definer set search_path = public as $$
  with w(event, weight) as (values ('perfume_view', 1), ('search_pick', 2), ('favorite_pick', 3), ('buy_click', 4), ('whatsapp_click', 4)),
  e as (
    select coalesce(nullif(e.perfume_id, ''), nullif(e.details->>'pid', ''), '') as pid, trim(e.perfume) as name, w.weight
    from events e join w on w.event = e.event
    where e.ts > now() - make_interval(days => greatest(1, least(365, coalesce(p_days, 30))))
  ),
  k as (select coalesce(nullif(pid, ''), name) as key, max(pid) as pid, max(name) as name, sum(weight) as score, count(*) as n
        from e where coalesce(nullif(pid, ''), name) <> '' group by 1)
  select jsonb_build_object('days', coalesce(p_days, 30), 'interactions', (select count(*) from e where coalesce(nullif(pid, ''), name) <> ''),
    'items', coalesce((select jsonb_agg(jsonb_build_object('pid', pid, 'perfume', name, 'score', score, 'n', n) order by score desc)
                       from (select * from k order by score desc limit 30) t), '[]'::jsonb));
$$;
revoke all on function public.popular_items(int) from public;
grant execute on function public.popular_items(int) to anon, authenticated;

-- 2) the next free perfume id (FF-0090, FF-0091…), for the team's «🧴 العطور» page
create or replace function public.next_perfume_id() returns text
language sql stable security definer set search_path = public as $$
  select case when public.is_admin()
    then 'FF-' || lpad((coalesce(max(substring(perfume_id from 4)::int), 0) + 1)::text, 4, '0') end
  from perfumes where perfume_id ~ '^FF-[0-9]+$';
$$;
revoke all on function public.next_perfume_id() from public;
grant execute on function public.next_perfume_id() to authenticated;

-- 3) values the quiz engine understands (checked on new or changed perfumes; existing rows are left as they are)
alter table public.perfumes drop constraint if exists perfumes_values_ok;
alter table public.perfumes add constraint perfumes_values_ok check (
  gender in ('men', 'women', 'unisex')
  and size_type in ('full', 'decant')
  and (world = '' or world in ('designer', 'niche', 'ultra_niche', 'arabian'))
  and (ref_price is null or ref_price >= 0)
  and length(name) between 1 and 120 and length(brand) <= 80
  and (image_url = '' or image_url ~ '^https://')) not valid;
