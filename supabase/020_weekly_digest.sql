-- RihaFlow · the weekly summary e-mail to each store (sent by Apps Script every Monday morning).
-- Paste in SQL Editor → Run (after 019). Safe to run again.
--
-- stores.digest   the merchant can turn the e-mail off in «⚙️ إعدادات المتجر» (on by default)
-- weekly_digest() for Apps Script only (secret key): every live store that wants the e-mail, with its last 7 days
--                 (against the 7 before), its most shown perfume, what customers asked for without finding it,
--                 and the e-mails of its accounts. Aggregates only.

alter table public.stores add column if not exists digest boolean not null default true;
grant update (digest) on public.stores to authenticated;   -- the store's own row only (policy stores_member_update)

-- «ما لم يجدوه» without the membership check, for server use; store_missed (018) keeps the check and calls it
create or replace function public.missed_json(p_store text, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_days int := greatest(1, least(90, coalesce(p_days, 30)));
  v_from timestamptz := (((now() at time zone 'Africa/Casablanca')::date - (greatest(1, least(90, coalesce(p_days, 30))) - 1))::timestamp at time zone 'Africa/Casablanca');
  res jsonb;
begin
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
revoke all on function public.missed_json(text, int) from public, anon, authenticated;

create or replace function public.store_missed(p_store text, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_member(p_store) or public.is_admin()) then return jsonb_build_object('error', 'invalid'); end if;
  return public.missed_json(p_store, p_days);
end $$;
revoke all on function public.store_missed(text, int) from public, anon;
grant execute on function public.store_missed(text, int) to authenticated;

create or replace function public.weekly_digest() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', s.id, 'name', s.name,
      'emails', (select coalesce(jsonb_agg(distinct u.email), '[]'::jsonb) from store_members m join auth.users u on u.id = m.user_id where m.store_id = s.id and coalesce(u.email, '') <> ''),
      'stats', (select jsonb_build_object('totals', j -> 'totals', 'prev', j -> 'prev', 'top', j -> 'perfumes' -> 0) from (select public.stats_json(s.id, 7, null) j) t),
      'missed', (select jsonb_build_object('n', m -> 'missed', 'top', m -> 'requests' -> 0) from (select public.missed_json(s.id, 7) m) t),
      'offers', (select count(*) from offers o where o.store_id = s.id and o.active and o.in_stock)
    ) x
    from stores s
    where s.id <> 'demo' and s.digest and public.store_is_live(s.id)
      and exists (select 1 from store_members m where m.store_id = s.id)
  ) q
$$;
revoke all on function public.weekly_digest() from public, anon, authenticated;
grant execute on function public.weekly_digest() to service_role;
grant execute on function public.stats_json(text, int, text) to service_role;
grant execute on function public.missed_json(text, int) to service_role;
