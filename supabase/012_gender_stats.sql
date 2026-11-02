-- FragranceFlow · statistics: who the perfume is for (women / men / for everyone), from the quiz's first answer.
-- Paste in SQL Editor → Run. Safe to run again.
-- The answer was already recorded with every finished quiz (events.details->>'gender'); this counts it, adds it to
-- the store's numbers (dashboard, portal, monthly report), and recounts the past days so the history has it too.

-- 1) the daily numbers: + 'gender' (men / women / unisex) for each finished quiz
create or replace function public.compute_stats(d_from date, d_to date)
returns table (day date, store_id text, metric text, dimension text, value integer)
language sql stable security definer set search_path = public as $$
  with e as (
    select id, ts, (ts at time zone 'Africa/Casablanca')::date as day, event,
           coalesce(nullif(visit, ''), nullif(details->>'visit', ''), '~' || id) as vis,
           lower(source) as source, character, impression, lower(coalesce(details->>'gender', '')) as gender,
           coalesce(nullif(lower(events.store_id), ''), nullif(lower(details->>'shop'), ''), '_site') as store,
           public.event_pid(coalesce(nullif(perfume_id, ''), details->>'pid'), perfume) as pid
    from events
    where ts >= (greatest(d_from, date '2026-10-26')::timestamp at time zone 'Africa/Casablanca')
      and ts < ((d_to + 1)::timestamp at time zone 'Africa/Casablanca')
  ),
  per_event as (
    select e.day, store, 'quizzes' m, 'all' dim from e where event = 'quiz_complete'
    union all select e.day, store, 'family', character from e where event = 'quiz_complete' and character <> ''
    union all select e.day, store, 'impression', impression from e where event = 'quiz_complete' and impression <> ''
    union all select e.day, store, 'gender', gender from e where event = 'quiz_complete' and gender in ('men', 'women', 'unisex')
    union all select e.day, store, 'perfume', pid from e where event = 'result_shown' and pid <> ''
    union all select e.day, store, 'whatsapp', 'all' from e where event in ('whatsapp_click', 'near_whatsapp_click')
    union all select e.day, store, 'whatsapp_perfume', pid from e where event in ('whatsapp_click', 'near_whatsapp_click') and pid <> ''
    union all select e.day, store, 'shares', 'all' from e where event in ('personality_share_whatsapp','personality_share_facebook','personality_share_instagram','personality_share_copy')
    union all select e.day, store, 'near', 'all' from e where event in ('near_results', 'lost_sale')
  ),
  visits as (
    select e.day, store, vis,
           (array_agg(source order by ts, id) filter (where source <> ''))[1] as source,
           bool_or(event = 'widget_open') as opened, bool_or(event = 'quiz_complete') as completed,
           bool_or(event in ('whatsapp_click', 'near_whatsapp_click')) as wa
    from e group by e.day, store, vis
  ),
  per_visit as (
    select v.day, store, 'experiences' m, 'all' dim from visits v where opened or completed
    union all select v.day, store, 'source', coalesce(source, 'direct') from visits v where opened or completed
    union all select v.day, store, 'completed', 'all' from visits v where completed
    union all select v.day, store, 'whatsapp_visits', 'all' from visits v where (opened or completed) and wa
  )
  select x.day, x.store, x.m, x.dim, count(*)::int from (select * from per_event union all select * from per_visit) x group by 1, 2, 3, 4;
$$;
revoke all on function public.compute_stats(date, date) from public, anon, authenticated;

-- 2) one store's numbers: + "gender": {"women": n, "men": n, "unisex": n}
create or replace function public.stats_json(s text, p_days int, p_month text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  start date := date '2026-10-26';
  today date := (now() at time zone 'Africa/Casablanca')::date;
  v_from date; v_to date; prev_from date; prev_to date; first date; last date; n int; mon text := ''; st record; out jsonb;
begin
  select id, name, logo_url, color into st from stores where id = s;
  if not found then return jsonb_build_object('error', 'invalid'); end if;
  if coalesce(p_month, '') ~ '^[0-9]{4}-[0-9]{2}$' then
    mon := p_month; first := (p_month || '-01')::date; last := (first + interval '1 month' - interval '1 day')::date;
    if first > today or last < start then return jsonb_build_object('error', 'month'); end if;
    v_from := greatest(first, start); v_to := least(last, today);
    prev_from := (first - interval '1 month')::date; prev_to := first - 1;
  else
    n := greatest(7, least(90, coalesce(p_days, 30)));
    v_to := today; v_from := greatest(today - (n - 1), start);
    prev_from := v_from - (today - v_from + 1); prev_to := v_from - 1;
  end if;

  with lines as (
    select d.day, d.metric, d.dimension, d.value from daily_stats d where d.store_id = s and d.day between v_from and v_to and d.day < today
    union all
    select c.day, c.metric, c.dimension, c.value from public.compute_stats(today, today) c where v_to = today and c.store_id = s
  ),
  days as (select g::date as day from generate_series(v_from, v_to, interval '1 day') g),
  dims as (select metric, dimension, sum(value)::int v from lines where dimension <> 'all' group by 1, 2),
  perf as (
    select coalesce(p.dimension, w.dimension) id, coalesce(p.v, 0) shown, coalesce(w.v, 0) wa
    from (select dimension, v from dims where metric = 'perfume') p
    full join (select dimension, v from dims where metric = 'whatsapp_perfume') w on w.dimension = p.dimension
  )
  select jsonb_build_object(
    'store', jsonb_build_object('id', st.id, 'name', st.name,
      'logo', case when st.logo_url ~ '^https://' then st.logo_url else '' end,
      'color', case when st.color ~* '^#[0-9a-f]{6}$' then st.color else '' end),
    'from', v_from, 'to', v_to,
    'days', (select jsonb_agg(to_char(day, 'YYYY-MM-DD') order by day) from days),
    'series', (select jsonb_object_agg(m, (select jsonb_agg(coalesce((select sum(l.value) from lines l where l.day = d.day and l.metric = m and l.dimension = 'all'), 0) order by d.day) from days d))
               from unnest(array['experiences', 'completed', 'whatsapp', 'shares']) m),
    'totals', coalesce((select jsonb_object_agg(metric, v) from (select metric, sum(value)::int v from lines where dimension = 'all' group by 1) t), '{}'::jsonb),
    'month', mon,
    'months', (select jsonb_agg(to_char(g, 'YYYY-MM') order by g desc) from generate_series(date_trunc('month', start), date_trunc('month', today), interval '1 month') g),
    'partial', case when mon = '' then false else (v_to = today or v_from > first) end,
    'prev', case when prev_from >= start then coalesce((select jsonb_object_agg(metric, v) from (
              select metric, sum(value)::int v from daily_stats where store_id = s and dimension = 'all' and day between prev_from and prev_to and day >= start group by 1) t), '{}'::jsonb) end,
    'source', coalesce((select jsonb_object_agg(dimension, v) from dims where metric = 'source'), '{}'::jsonb),
    'family', coalesce((select jsonb_object_agg(dimension, v) from dims where metric = 'family'), '{}'::jsonb),
    'impression', coalesce((select jsonb_object_agg(dimension, v) from dims where metric = 'impression'), '{}'::jsonb),
    'gender', coalesce((select jsonb_object_agg(dimension, v) from dims where metric = 'gender'), '{}'::jsonb),
    'perfumes', coalesce((select jsonb_agg(x order by (x->>'shown')::int desc, (x->>'whatsapp')::int desc) from (
        select jsonb_build_object('id', perf.id, 'name', coalesce(nullif(f.name, ''), perf.id), 'brand', coalesce(f.brand, ''),
               'image', case when f.image_url ~ '^https://' then f.image_url else '' end, 'shown', perf.shown, 'whatsapp', perf.wa) x
        from perf left join perfumes f on upper(f.perfume_id) = upper(perf.id)
        order by perf.shown desc, perf.wa desc limit 10) top), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.stats_json(text, int, text) from public, anon, authenticated;

-- 3) the days already counted, recounted with the new line (from the start of Supabase statistics until yesterday)
select public.rebuild_daily_stats(date '2026-10-26', (now() at time zone 'Africa/Casablanca')::date - 1) as rows_written;
