-- RihaFlow · «ما طلبه زبناؤك ولم يجدوه»: what a store's customers asked for in the quiz without finding a perfume
-- that fits well (the quiz's lost_sale event: no result, or the best one below 70%).
-- Paste in SQL Editor → Run (after 017). Safe to run again.
--
-- Aggregates only, from the quiz answers (no personal data): the most frequent requests (for whom + family),
-- with their most common occasion, impression, season and budget, and how many perfumes the store already
-- has in stock for that request. A visitor who redoes the quiz with the same request counts once.

create or replace function public.store_missed(p_store text, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_days int := greatest(1, least(90, coalesce(p_days, 30)));
  v_from timestamptz := (((now() at time zone 'Africa/Casablanca')::date - (greatest(1, least(90, coalesce(p_days, 30))) - 1))::timestamp at time zone 'Africa/Casablanca');
  res jsonb;
begin
  if not (public.is_member(p_store) or public.is_admin()) then return jsonb_build_object('error', 'invalid'); end if;
  with e as (
    select ev.event, ev.ts, coalesce(nullif(ev.visit, ''), '~' || ev.id) vis,
           lower(coalesce(ev.character, '')) fam, lower(coalesce(ev.impression, '')) imp,
           lower(coalesce(ev.details ->> 'gender', '')) gen, lower(coalesce(ev.details ->> 'occasion', '')) occ,
           lower(coalesce(ev.details ->> 'season', '')) sea, lower(coalesce(ev.details ->> 'budget', '')) bud
    from events ev
    where ev.ts >= v_from and ev.event in ('lost_sale', 'quiz_complete')
      and coalesce(nullif(lower(ev.store_id), ''), lower(ev.details ->> 'shop')) = lower(p_store)
  ),
  lost as (select distinct on (vis, gen, fam) * from e where event = 'lost_sale' order by vis, gen, fam, ts desc),
  combos as (
    select gen, fam, count(*)::int k,
           mode() within group (order by nullif(occ, '')) occ, mode() within group (order by nullif(imp, '')) imp,
           mode() within group (order by nullif(sea, '')) sea, mode() within group (order by nullif(nullif(bud, ''), 'any')) bud
    from lost where fam <> '' group by gen, fam order by k desc, fam limit 5
  ),
  stock as (
    select string_to_array(replace(lower(coalesce(f.character, '')), ' ', ''), ',') fams, lower(f.gender) gender
    from offers o join perfumes f on upper(f.perfume_id) = upper(o.perfume_id)
    where o.store_id = p_store and o.active and o.in_stock and f.active
  )
  select jsonb_build_object(
    'days', v_days,
    'completed', (select count(distinct vis) from e where event = 'quiz_complete'),
    'missed', (select count(distinct vis) from lost),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
        'gender', c.gen, 'family', c.fam, 'n', c.k, 'occasion', c.occ, 'impression', c.imp, 'season', c.sea, 'budget', c.bud,
        'have', (select count(*) from stock s where c.fam = any(s.fams)
                   and (c.gen = '' or s.gender = 'unisex' or s.gender = c.gen))
      ) order by c.k desc, c.fam) from combos c), '[]'::jsonb),
    'budget', coalesce((select jsonb_object_agg(bud, k) from (select bud, count(*)::int k from lost where bud not in ('', 'any') group by 1) b), '{}'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.store_missed(text, int) from public, anon;
grant execute on function public.store_missed(text, int) to authenticated;
