-- FragranceFlow · the team's overview: platform-wide numbers for the FragranceFlow team only.
-- Paste in SQL Editor → Run (after 012). Safe to run again.
-- Aggregates only (no visitor-level data): activity day by day, what customers look for across all stores,
-- the perfumes that come up most, subscriptions, and the health of the catalogue.

create or replace function public.admin_insights(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  start date := date '2026-10-26';
  today date := (now() at time zone 'Africa/Casablanca')::date;
  n int := greatest(1, least(90, coalesce(p_days, 7)));
  v_from date; out jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'invalid'); end if;
  v_from := greatest(today - (n - 1), start);

  with lines as (
    select d.day, d.store_id, d.metric, d.dimension, d.value from daily_stats d
      where d.day between v_from and today - 1 and d.store_id in (select id from stores)
    union all
    select c.day, c.store_id, c.metric, c.dimension, c.value from public.compute_stats(today, today) c
      where c.store_id in (select id from stores)
  ),
  days as (select g::date as day from generate_series(v_from, today, interval '1 day') g),
  dims as (select metric, dimension, sum(value)::int v from lines where dimension <> 'all' group by 1, 2),
  tot as (select metric, sum(value)::int v from lines where dimension = 'all' group by 1),
  perf as (
    select coalesce(p.dimension, w.dimension) id, coalesce(p.v, 0) shown, coalesce(w.v, 0) wa
    from (select dimension, v from dims where metric = 'perfume') p
    full join (select dimension, v from dims where metric = 'whatsapp_perfume') w on w.dimension = p.dimension
  ),
  subs as (
    select s.id, s.name, s.active, s.subscription_status st, s.trial_ends_at,
           (s.subscription_status = 'trial' and s.trial_ends_at is not null and s.trial_ends_at < now()) as expired
    from stores s where s.id <> 'demo'
  )
  select jsonb_build_object(
    'from', v_from, 'to', today, 'days', n,
    'dates', (select jsonb_agg(to_char(day, 'YYYY-MM-DD') order by day) from days),
    'series', (select jsonb_object_agg(m, (select jsonb_agg(coalesce((select sum(l.value) from lines l where l.day = d.day and l.metric = m and l.dimension = 'all'), 0) order by d.day) from days d))
               from unnest(array['experiences', 'completed', 'whatsapp']) m),
    'totals', coalesce((select jsonb_object_agg(metric, v) from tot), '{}'::jsonb),
    'family', coalesce((select jsonb_object_agg(dimension, v) from dims where metric = 'family'), '{}'::jsonb),
    'gender', coalesce((select jsonb_object_agg(dimension, v) from dims where metric = 'gender'), '{}'::jsonb),
    'impression', coalesce((select jsonb_object_agg(dimension, v) from dims where metric = 'impression'), '{}'::jsonb),
    'source', coalesce((select jsonb_object_agg(dimension, v) from dims where metric = 'source'), '{}'::jsonb),
    'perfumes', coalesce((select jsonb_agg(x order by (x->>'shown')::int desc, (x->>'whatsapp')::int desc) from (
        select jsonb_build_object('id', perf.id, 'name', coalesce(nullif(f.name, ''), perf.id), 'brand', coalesce(f.brand, ''),
               'image', case when f.image_url ~ '^https://' then f.image_url else '' end, 'shown', perf.shown, 'whatsapp', perf.wa,
               'stores', (select count(*) from offers o where upper(o.perfume_id) = upper(perf.id) and o.active and o.in_stock)) x
        from perf left join perfumes f on upper(f.perfume_id) = upper(perf.id)
        order by perf.shown desc, perf.wa desc limit 10) top), '[]'::jsonb),
    'subscriptions', jsonb_build_object(
      'active', (select count(*) from subs where active and st = 'active'),
      'trial', (select count(*) from subs where active and st = 'trial' and not expired),
      'expired', (select count(*) from subs where active and expired),
      'paused', (select count(*) from subs where st in ('paused', 'cancelled') or not active),
      'ending', coalesce((select jsonb_agg(jsonb_build_object('store', name, 'date', to_char(trial_ends_at at time zone 'Africa/Casablanca', 'YYYY-MM-DD')) order by trial_ends_at)
                 from subs where active and st = 'trial' and not expired and trial_ends_at < now() + interval '7 days'), '[]'::jsonb)),
    'catalog', jsonb_build_object(
      'perfumes', (select count(*) from perfumes where active),
      'noImage', (select count(*) from perfumes where active and coalesce(image_url, '') !~ '^https://'),
      'noNotes', (select count(*) from perfumes where active and coalesce(notes_top, '') = '' and coalesce(notes_mid, '') = '' and coalesce(notes_base, '') = ''),
      'noConcentration', (select count(*) from perfumes where active and coalesce(concentration, '') = ''),
      'neverOffered', (select count(*) from perfumes f where active and not exists (select 1 from offers o where o.perfume_id = f.perfume_id and o.active)),
      'offers', (select count(*) from offers o join stores s on s.id = o.store_id where o.active and o.in_stock and s.active and s.id <> 'demo'),
      'storesEmpty', (select count(*) from stores s where s.active and s.id <> 'demo' and not exists (select 1 from offers o where o.store_id = s.id and o.active and o.in_stock)),
      'requests', (select count(*) from requests where status = 'pending'))
  ) into out;
  return out;
end $$;
revoke all on function public.admin_insights(int) from public, anon;
grant execute on function public.admin_insights(int) to authenticated;
