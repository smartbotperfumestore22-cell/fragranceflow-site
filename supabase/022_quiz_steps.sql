-- RihaFlow · where customers stop in the quiz.
-- Paste in SQL Editor → Run (after 021, or after 020 if 021 was not run). Safe to run again.
--
-- The quiz now records «quiz_step» each time a question is answered (once per question and visit), with the
-- question's id. quiz_steps() turns it into a funnel for the RihaFlow team: how many visits opened the quiz,
-- answered each question, and finished. Aggregates only, no personal data. The quiz and its ranking are unchanged.

-- record_event accepts the new event (everything else is as in 005)
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
                'personality_share_copy','perfume_view','search_pick','near_results','near_whatsapp_click','quiz_step') then return 'ignored'; end if;
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

create index if not exists events_event_ts_idx on public.events (event, ts);

-- the funnel over the last p_days days (Casablanca), for one store or all of them (p_store null), team only
create or replace function public.quiz_steps(p_days int default 7, p_store text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  n int := greatest(1, least(90, coalesce(p_days, 7)));
  v_from timestamptz := (((now() at time zone 'Africa/Casablanca')::date - (greatest(1, least(90, coalesce(p_days, 7))) - 1))::timestamp at time zone 'Africa/Casablanca');
  first_step timestamptz := (select min(ts) from events where event = 'quiz_step');
  res jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'invalid'); end if;
  -- counting starts when the quiz began recording steps, so older visits never look like early exits
  if first_step is null then return jsonb_build_object('days', n, 'tracking', false); end if;
  v_from := greatest(v_from, first_step - interval '30 minutes');   -- the first visitor's opening comes just before its first step
  with e as (
    select ev.event, ev.visit, coalesce(ev.details ->> 'q', '') q
    from events ev
    where ev.ts >= v_from and ev.visit <> '' and ev.event in ('widget_open', 'quiz_step', 'quiz_complete')
      and (p_store is null or coalesce(nullif(lower(ev.store_id), ''), lower(ev.details ->> 'shop')) = lower(p_store))
  )
  select jsonb_build_object(
    'days', n, 'tracking', true, 'since', first_step,
    'opened', (select count(distinct visit) from e where event = 'widget_open'),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('q', q, 'n', k) order by ord) from (
        select q, count(distinct visit)::int k,
               array_position(array['gender','occasion','season','character','impression','world','sizeType','budget'], q) ord
        from e where event = 'quiz_step' and q <> '' group by q) s), '[]'::jsonb),
    'completed', (select count(distinct visit) from e where event = 'quiz_complete')
  ) into res;
  return res;
end $$;
revoke all on function public.quiz_steps(int, text) from public, anon;
grant execute on function public.quiz_steps(int, text) to authenticated;
