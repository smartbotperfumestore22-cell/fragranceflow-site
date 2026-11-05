-- RihaFlow · team roles and activity log.
-- Paste in SQL Editor → Run (after 015). Safe to run again.
--
-- Two roles in the RihaFlow team (table admins):
--   admin  everything: subscriptions and trials, removing a store or an account, the team, revenue, the activity log
--   agent  the daily work: the catalogue, perfume requests, helping a store (its perfumes and settings),
--          new stores and merchant accounts (always a 7-day trial)
-- Everyone already in admins stays admin. public.is_admin() keeps its meaning «anyone in the team»
-- (all the existing rules use it); public.is_superadmin() is the admin role only.
-- The limits are enforced here and in Apps Script, not only by hiding buttons.

alter table public.admins add column if not exists role text not null default 'admin';
alter table public.admins add column if not exists created_at timestamptz not null default now();
do $$ begin
  alter table public.admins add constraint admins_role_check check (role in ('admin', 'agent'));
exception when duplicate_object then null; end $$;

-- the signed-in person's role in the team: 'admin', 'agent', or null (merchant, visitor, Apps Script)
create or replace function public.team_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.admins where user_id = auth.uid();
$$;
create or replace function public.is_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.team_role() = 'admin', false);
$$;
grant execute on function public.team_role() to authenticated;
grant execute on function public.is_superadmin() to authenticated;

-- an admin may read the whole team (the portal reads its own row as before)
drop policy if exists admins_read_all on public.admins;
create policy admins_read_all on public.admins for select using (public.is_superadmin());

-- ───────────── what an agent may not do ─────────────
-- stores: a new store always starts with the usual 7-day trial; subscription, trial and «active» stay with the admin; no deleting
create or replace function public.ff_stores_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.team_role() is distinct from 'agent' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'agent_forbidden: only an admin can remove a store' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then
    new.subscription_status := 'trial'; new.trial_started_at := now(); new.trial_ends_at := now() + interval '7 days'; new.active := true;
  elsif new.subscription_status is distinct from old.subscription_status or new.trial_ends_at is distinct from old.trial_ends_at
     or new.trial_started_at is distinct from old.trial_started_at or new.active is distinct from old.active then
    raise exception 'agent_forbidden: only an admin can change the subscription' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists ff_stores_guard on public.stores;
create trigger ff_stores_guard before insert or update or delete on public.stores for each row execute function public.ff_stores_guard();

-- the admin changes a store's subscription from the portal (merchants and agents cannot write these columns)
--   p_status: trial / active / paused / cancelled; p_trial_end: the trial's last moment (only with trial)
create or replace function public.set_subscription(p_store text, p_status text, p_trial_end timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s stores;
begin
  if not public.is_superadmin() then return jsonb_build_object('error', 'forbidden'); end if;
  if p_status not in ('trial', 'active', 'paused', 'cancelled') then return jsonb_build_object('error', 'status'); end if;
  if p_status = 'trial' and (p_trial_end is null or p_trial_end < now() or p_trial_end > now() + interval '1 year') then return jsonb_build_object('error', 'date'); end if;
  update stores set subscription_status = p_status,
    trial_ends_at = case when p_status = 'trial' then p_trial_end when p_status = 'active' then null else trial_ends_at end
  where id = p_store returning * into s;
  if s.id is null then return jsonb_build_object('error', 'store'); end if;
  return jsonb_build_object('ok', true, 'subscription_status', s.subscription_status, 'trial_ends_at', s.trial_ends_at);
end $$;
revoke all on function public.set_subscription(text, text, timestamptz) from public, anon;
grant execute on function public.set_subscription(text, text, timestamptz) to authenticated;

-- store accounts: an agent may link an account to a store, not remove it
create or replace function public.ff_members_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.team_role() = 'agent' then raise exception 'agent_forbidden: only an admin can remove an account' using errcode = '42501'; end if;
  return old;
end $$;
drop trigger if exists ff_members_guard on public.store_members;
create trigger ff_members_guard before delete on public.store_members for each row execute function public.ff_members_guard();

-- ───────────── activity log: who changed what, and when ─────────────
-- Changes made by the team in the portal are written here automatically; actions that go through
-- Apps Script (new accounts, passwords, the team) are written by Apps Script with the person's email.
-- Merchants' own changes are not logged here (the offers history already keeps price changes).
create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_email text not null default '',
  actor_role  text not null default '',
  action      text not null,              -- table.op (perfumes.update, stores.insert…) or an Apps Script action
  store_id    text,
  target      text not null default '',   -- what was changed, in words (perfume name, store id, email…)
  detail      jsonb not null default '{}'::jsonb   -- changed fields: {"price": [old, new], …}
);
create index if not exists activity_log_at on public.activity_log (at desc);
alter table public.activity_log enable row level security;
revoke all on public.activity_log from anon, authenticated;

create or replace function public.ff_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r text := public.team_role(); o jsonb; n jsonb; d jsonb := '{}'::jsonb; rw jsonb; tgt text; sid text;
begin
  if r is null then return null; end if;               -- merchants, visitors and Apps Script: not logged here
  o := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  rw := coalesce(n, o);
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, jsonb_build_array(o -> k, n -> k)), '{}'::jsonb) into d
    from jsonb_object_keys(n) k where k not in ('updated_at', 'created_at') and (o -> k) is distinct from (n -> k);
    if d = '{}'::jsonb then return null; end if;
  end if;
  sid := case tg_table_name when 'stores' then rw ->> 'id' else rw ->> 'store_id' end;
  tgt := case tg_table_name
    when 'perfumes' then coalesce(rw ->> 'name', '') || ' · ' || coalesce(rw ->> 'brand', '') || ' (' || (rw ->> 'perfume_id') || ')'
    when 'offers' then coalesce((select p.name || ' · ' || p.brand from perfumes p where p.perfume_id = rw ->> 'perfume_id'), rw ->> 'perfume_id')
    when 'stores' then coalesce(rw ->> 'name', rw ->> 'id')
    when 'requests' then coalesce(rw ->> 'perfume_name', '') || coalesce(' · ' || nullif(rw ->> 'brand', ''), '')
    when 'store_members' then coalesce((select u.email from auth.users u where u.id = (rw ->> 'user_id')::uuid), rw ->> 'user_id')
    else '' end;
  if tg_op = 'INSERT' and tg_table_name in ('perfumes', 'stores') then d := jsonb_build_object('new', n - 'created_at'); end if;
  insert into activity_log (actor, actor_email, actor_role, action, store_id, target, detail)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''), r, tg_table_name || '.' || lower(tg_op), sid, left(tgt, 200), d);
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['perfumes', 'stores', 'offers', 'requests', 'store_members'] loop
    execute format('drop trigger if exists ff_log on public.%I', t);
    execute format('create trigger ff_log after insert or update or delete on public.%I for each row execute function public.ff_log()', t);
  end loop;
end $$;

-- the log for the portal (admins only), newest first, page by page
create or replace function public.activity_list(p_limit int default 50, p_before bigint default null, p_actor text default null)
returns setof public.activity_log
language sql stable security definer set search_path = public as $$
  select * from public.activity_log
  where public.is_superadmin()
    and (p_before is null or id < p_before)
    and (p_actor is null or p_actor = '' or actor_email = p_actor)
  order by id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;
revoke all on function public.activity_list(int, bigint, text) from public, anon;
grant execute on function public.activity_list(int, bigint, text) to authenticated;

-- keep one year of history (every Sunday at 03:30 UTC); skipped if pg_cron is not enabled
do $$ begin
  perform cron.schedule('ff-activity-cleanup', '30 3 * * 0', $c$delete from public.activity_log where at < now() - interval '1 year'$c$);
exception when others then null; end $$;

-- check: the team and its roles
select a.user_id, u.email, a.role from public.admins a left join auth.users u on u.id = a.user_id order by a.role, u.email;
