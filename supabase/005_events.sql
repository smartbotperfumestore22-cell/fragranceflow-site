-- FragranceFlow · Phase 2 (step 1): visit events and daily statistics in Supabase.
-- The site records every event here AND in the Google Sheet while we compare the numbers.
-- Paste in SQL Editor → Run. Safe to run again.

create table if not exists public.events (
  id           bigint generated always as identity primary key,
  ts           timestamptz not null default now(),
  event        text not null,
  visit        text not null default '',
  source       text not null default '',
  perfume      text not null default '',     -- perfume name or quiz answer, as sent
  character    text not null default '',
  impression   text not null default '',
  details      jsonb,
  store_id     text not null default '',     -- '' = the public quiz (no store)
  perfume_id   text not null default '',
  imported_row integer unique                -- row number in the Sheet's Events tab (only for imported history)
);
create index if not exists events_ts_idx on public.events (ts);
create index if not exists events_visit_idx on public.events (visit, ts);
create index if not exists events_store_idx on public.events (store_id, ts);

create table if not exists public.daily_stats (
  day       date not null,
  store_id  text not null,                   -- '_site' = the public quiz
  metric    text not null,
  dimension text not null default 'all',
  value     integer not null,
  primary key (day, store_id, metric, dimension)
);

-- nobody reads or writes these tables directly from the browser: events go through record_event(),
-- numbers come out through the statistics functions (next step). The team can read them in Supabase.
alter table public.events enable row level security;
alter table public.daily_stats enable row level security;
drop policy if exists events_admin on public.events;
create policy events_admin on public.events for select using (public.is_admin());
drop policy if exists daily_stats_admin on public.daily_stats;
create policy daily_stats_admin on public.daily_stats for select using (public.is_admin());
revoke insert, update, delete on public.events, public.daily_stats from anon, authenticated;

-- the same checks as the Apps Script: known event, active store (if any), visit id, at most 80 events per visit per hour
create or replace function public.record_event(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  ev text := coalesce(p->>'event', '');
  shop text := lower(trim(coalesce(p->>'shop', '')));
  v text := trim(coalesce(p->>'visit', ''));
  src text := lower(trim(coalesce(nullif(p->>'source', ''), p->>'utm', '')));
  det jsonb := '{}'::jsonb;
  k text;
  n int := 0;
begin
  if ev not in ('widget_open','quiz_complete','result_shown','persona_feedback','favorite_pick','buy_click','whatsapp_click','lost_sale',
                'personality_share_click','personality_share_whatsapp','personality_share_facebook','personality_share_instagram',
                'personality_share_copy','perfume_view','search_pick','near_results','near_whatsapp_click') then return 'ignored'; end if;
  if shop <> '' and not exists (select 1 from stores where id = shop and active) then return 'ignored'; end if;
  if v !~ '^[A-Za-z0-9_-]{4,20}$' then return 'ignored'; end if;
  if (select count(*) from events where visit = v and ts > now() - interval '1 hour') >= 80 then return 'ignored'; end if;
  if src in ('ig', 'insta') then src := 'instagram'; elsif src = 'wa' then src := 'whatsapp'; end if;
  if src <> '' and src not in ('instagram','whatsapp','facebook','tiktok','website','qr','direct') then src := 'other'; end if;
  for k in select jsonb_object_keys(p) loop
    exit when n >= 30;
    if k not in ('action','store','key','event','visit','utm','source','perfume','character','impression','shop','pid') then
      det := det || jsonb_build_object(left(k, 40), left(coalesce(p->>k, ''), 200)); n := n + 1;
    end if;
  end loop;
  insert into events (event, visit, source, perfume, character, impression, details, store_id, perfume_id)
  values (ev, left(v, 20), src, left(coalesce(p->>'perfume', ''), 120), left(coalesce(p->>'character', ''), 40),
          left(coalesce(p->>'impression', ''), 40), case when det = '{}'::jsonb then null else det end, shop, left(coalesce(p->>'pid', ''), 20));
  return 'ok';
end $$;
revoke all on function public.record_event(jsonb) from public;
grant execute on function public.record_event(jsonb) to anon, authenticated;

-- one perfume id from what an event carries: "ff-22" / "FF-0022" → FF-0022, else the name looked up in perfumes
drop function if exists public.event_pid(text, text);
create or replace function public.event_pid(p_raw text, p_name text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(p_raw, '') ~* '^ff-?0*[0-9]+$' then 'FF-' || lpad(regexp_replace(p_raw, '^[^0-9]*0*', ''), 4, '0')
    when coalesce(p_raw, '') <> '' then upper(p_raw)
    else coalesce((select f.perfume_id from perfumes f where lower(f.name) = lower(trim(coalesce(p_name, ''))) limit 1), '')
  end;
$$;

-- daily numbers, exactly as the Apps Script's statsOfDay_ (days in Morocco time, nothing before 2026-10-26)
create or replace function public.rebuild_daily_stats(d_from date, d_to date) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if d_from < date '2026-10-26' then d_from := date '2026-10-26'; end if;
  delete from daily_stats where day between d_from and d_to;
  with e as (
    select id, ts, (ts at time zone 'Africa/Casablanca')::date as day, event,
           coalesce(nullif(visit, ''), nullif(details->>'visit', ''), '~' || id) as vis,
           lower(source) as source, character, impression,
           coalesce(nullif(lower(store_id), ''), nullif(lower(details->>'shop'), ''), '_site') as store,
           public.event_pid(coalesce(nullif(perfume_id, ''), details->>'pid'), perfume) as pid
    from events
    where ts >= (d_from::timestamp at time zone 'Africa/Casablanca') and ts < ((d_to + 1)::timestamp at time zone 'Africa/Casablanca')
  ),
  per_event as (
    select day, store, 'quizzes' m, 'all' dim from e where event = 'quiz_complete'
    union all select day, store, 'family', character from e where event = 'quiz_complete' and character <> ''
    union all select day, store, 'impression', impression from e where event = 'quiz_complete' and impression <> ''
    union all select day, store, 'perfume', pid from e where event = 'result_shown' and pid <> ''
    union all select day, store, 'whatsapp', 'all' from e where event in ('whatsapp_click', 'near_whatsapp_click')
    union all select day, store, 'whatsapp_perfume', pid from e where event in ('whatsapp_click', 'near_whatsapp_click') and pid <> ''
    union all select day, store, 'shares', 'all' from e where event in ('personality_share_whatsapp','personality_share_facebook','personality_share_instagram','personality_share_copy')
    union all select day, store, 'near', 'all' from e where event in ('near_results', 'lost_sale')
  ),
  visits as (
    select day, store, vis,
           (array_agg(source order by ts, id) filter (where source <> ''))[1] as source,
           bool_or(event = 'widget_open') as opened, bool_or(event = 'quiz_complete') as completed,
           bool_or(event in ('whatsapp_click', 'near_whatsapp_click')) as wa
    from e group by day, store, vis
  ),
  per_visit as (
    select day, store, 'experiences' m, 'all' dim from visits where opened or completed
    union all select day, store, 'source', coalesce(source, 'direct') from visits where opened or completed
    union all select day, store, 'completed', 'all' from visits where completed
    union all select day, store, 'whatsapp_visits', 'all' from visits where (opened or completed) and wa
  )
  insert into daily_stats (day, store_id, metric, dimension, value)
  select day, store, m, dim, count(*) from (select * from per_event union all select * from per_visit) x group by day, store, m, dim;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.rebuild_daily_stats(date, date) from public, anon, authenticated;
