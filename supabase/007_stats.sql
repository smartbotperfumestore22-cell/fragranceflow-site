-- FragranceFlow · Phase 2 (step 2): the statistics, the monthly report and the team overview read from Supabase.
-- Paste in SQL Editor → Run (after 005 and 006). Safe to run again.

-- 1) the daily numbers as rows, without writing them (used for "today", which is not in daily_stats yet)
create or replace function public.compute_stats(d_from date, d_to date)
returns table (day date, store_id text, metric text, dimension text, value integer)
language sql stable security definer set search_path = public as $$
  with e as (
    select id, ts, (ts at time zone 'Africa/Casablanca')::date as day, event,
           coalesce(nullif(visit, ''), nullif(details->>'visit', ''), '~' || id) as vis,
           lower(source) as source, character, impression,
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

create or replace function public.rebuild_daily_stats(d_from date, d_to date) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if d_from < date '2026-10-26' then d_from := date '2026-10-26'; end if;
  delete from daily_stats where day between d_from and d_to;
  insert into daily_stats (day, store_id, metric, dimension, value) select * from public.compute_stats(d_from, d_to);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.rebuild_daily_stats(date, date) from public, anon, authenticated;

-- 2) the secret dashboard links (?t=…) move here from the Sheet; nobody can read this table from the browser
create table if not exists public.store_tokens (
  store_id   text primary key references public.stores (id) on delete cascade,
  token      text not null unique check (token ~ '^[A-Za-z0-9]{32,80}$'),
  created_at timestamptz not null default now()
);
alter table public.store_tokens enable row level security;
revoke all on public.store_tokens from anon, authenticated;

-- 3) one store's numbers, the same answer as the Apps Script's statsFor_ (no access check here: see the wrappers below)
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
    'perfumes', coalesce((select jsonb_agg(x order by (x->>'shown')::int desc, (x->>'whatsapp')::int desc) from (
        select jsonb_build_object('id', perf.id, 'name', coalesce(nullif(f.name, ''), perf.id), 'brand', coalesce(f.brand, ''),
               'image', case when f.image_url ~ '^https://' then f.image_url else '' end, 'shown', perf.shown, 'whatsapp', perf.wa) x
        from perf left join perfumes f on upper(f.perfume_id) = upper(perf.id)
        order by perf.shown desc, perf.wa desc limit 10) top), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.stats_json(text, int, text) from public, anon, authenticated;

-- for a signed-in merchant (its own store) or the team (any store)
create or replace function public.store_stats(p_store text default null, p_days int default 30, p_month text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s text := lower(coalesce(p_store, ''));
begin
  if auth.uid() is null then return jsonb_build_object('error', 'login'); end if;
  if s = '' or not (public.is_member(s) or public.is_admin()) then
    select store_id into s from store_members where user_id = auth.uid() order by created_at limit 1;
  end if;
  if s is null or s = '' then return jsonb_build_object('error', 'invalid'); end if;
  return public.stats_json(s, p_days, p_month);
end $$;
revoke all on function public.store_stats(text, int, text) from public;
grant execute on function public.store_stats(text, int, text) to authenticated;

-- for the secret dashboard link
create or replace function public.store_stats_by_token(p_token text, p_days int default 30, p_month text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s text;
begin
  if coalesce(p_token, '') !~ '^[A-Za-z0-9]{32,80}$' then return jsonb_build_object('error', 'invalid'); end if;
  select t.store_id into s from store_tokens t join stores x on x.id = t.store_id where t.token = p_token and x.active;
  if s is null then return jsonb_build_object('error', 'invalid'); end if;
  return public.stats_json(s, p_days, p_month);
end $$;
revoke all on function public.store_stats_by_token(text, int, text) from public;
grant execute on function public.store_stats_by_token(text, int, text) to anon, authenticated;

-- 4) the team overview (same answer as the Apps Script's adminStatsFor_), team only
create or replace function public.admin_stats(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  start date := date '2026-10-26';
  today date := (now() at time zone 'Africa/Casablanca')::date;
  n int := greatest(1, least(90, coalesce(p_days, 7)));
  v_from date; prev_from date; out jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'invalid'); end if;
  v_from := today - (n - 1); prev_from := v_from - n;
  if v_from < start then v_from := start; end if;
  with lines as (
    select d.day, d.store_id, d.metric, d.value from daily_stats d where d.dimension = 'all' and d.day < today
    union all select c.day, c.store_id, c.metric, c.value from public.compute_stats(today, today) c where c.dimension = 'all'
  ),
  per_store as (
    select x.id, x.name, x.active, x.subscription_status, x.trial_ends_at,
      (select count(*) from offers o join perfumes f on f.perfume_id = o.perfume_id where o.store_id = x.id and o.active and o.in_stock and f.active)::int perfumes,
      coalesce((select sum(value) from lines l where l.store_id = x.id and l.metric = 'experiences' and l.day >= v_from), 0)::int experiences,
      coalesce((select sum(value) from lines l where l.store_id = x.id and l.metric = 'completed' and l.day >= v_from), 0)::int completed,
      coalesce((select sum(value) from lines l where l.store_id = x.id and l.metric = 'whatsapp' and l.day >= v_from), 0)::int whatsapp,
      (select max(day) from lines l where l.store_id = x.id and l.metric = 'experiences' and l.value > 0) last,
      exists (select 1 from store_members m where m.store_id = x.id) has_account
    from stores x
  ),
  alerts as (
    select 1 o, 'inactive' t, name, 'ما كاين حتى نشاط من ' || start s from per_store where active and last is null
    union all select 1, 'inactive', name, 'آخر نشاط نهار ' || last || ' (أكثر من 7 أيام)' from per_store where active and last < today - 7
    union all select 2, 'token', name, 'ما عندو حتى حساب ف فضاء التاجر' from per_store where active and not has_account
    union all select 3, 'catalog', name, 'ما عندو حتى عطر متوفر' from per_store where active and perfumes = 0
    union all select 4, 'trial', name, 'سالات الفترة التجريبية نهار ' || to_char(trial_ends_at at time zone 'Africa/Casablanca', 'YYYY-MM-DD') from per_store
      where active and subscription_status = 'trial' and trial_ends_at < now()
  )
  select jsonb_build_object(
    'from', v_from, 'to', today, 'days', n,
    'totals', jsonb_build_object('experiences', (select coalesce(sum(experiences), 0) from per_store), 'completed', (select coalesce(sum(completed), 0) from per_store),
                                 'whatsapp', (select coalesce(sum(whatsapp), 0) from per_store)),
    'prev', case when prev_from >= start then (select jsonb_build_object(
              'experiences', coalesce(sum(value) filter (where metric = 'experiences'), 0), 'completed', coalesce(sum(value) filter (where metric = 'completed'), 0),
              'whatsapp', coalesce(sum(value) filter (where metric = 'whatsapp'), 0))
            from lines l where l.day >= prev_from and l.day < v_from and l.day >= start and l.store_id in (select id from stores)) end,
    'site', (select jsonb_build_object('experiences', coalesce(sum(value) filter (where metric = 'experiences'), 0), 'completed', coalesce(sum(value) filter (where metric = 'completed'), 0),
              'whatsapp', coalesce(sum(value) filter (where metric = 'whatsapp'), 0)) from lines where store_id = '_site' and day >= v_from),
    'storesActive', (select count(*) from per_store where active),
    'storesWithActivity', (select count(*) from per_store where experiences > 0),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'active', active, 'perfumes', perfumes, 'experiences', experiences,
              'completed', completed, 'whatsapp', whatsapp, 'last', coalesce(to_char(last, 'YYYY-MM-DD'), ''), 'dashboard', '', 'hasToken', has_account)
              order by active desc, experiences desc, name) from per_store), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(jsonb_build_object('type', t, 'store', name, 'text', s) order by o, name) from alerts), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.admin_stats(int) from public;
grant execute on function public.admin_stats(int) to authenticated;
