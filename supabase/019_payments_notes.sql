-- RihaFlow · payments and notes for each store, in the team space (🏪 المتاجر › 📁 ملف المتجر).
-- Paste in SQL Editor → Run (after 018). Safe to run again.
--
-- store_payments  what a store paid, when, and until when it is covered. Admins only (agents and merchants
--                 never see amounts, like the revenue). «مؤدى حتى» = the latest paid_until.
-- store_notes     the team's notes on a store (calls, promises, problems), with an optional follow-up date
--                 that shows on the team's home page until it is marked done. Admins and agents.
-- Both are written in the activity log (016).

create table if not exists public.store_payments (
  id          bigint generated always as identity primary key,
  store_id    text not null references public.stores (id) on delete cascade,
  amount      numeric(10, 2) not null check (amount > 0 and amount < 1000000),
  paid_at     date not null default ((now() at time zone 'Africa/Casablanca')::date),
  paid_until  date not null,
  method      text not null default 'cash' check (method in ('cash', 'transfer', 'card', 'other')),
  note        text not null default '' check (length(note) <= 300),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  check (paid_until >= paid_at - 31)
);
create index if not exists store_payments_store on public.store_payments (store_id, paid_until desc);
alter table public.store_payments enable row level security;
drop policy if exists store_payments_admin on public.store_payments;
create policy store_payments_admin on public.store_payments for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
revoke all on public.store_payments from anon;
grant select, insert, update, delete on public.store_payments to authenticated;

create table if not exists public.store_notes (
  id           bigint generated always as identity primary key,
  store_id     text not null references public.stores (id) on delete cascade,
  body         text not null check (length(btrim(body)) between 1 and 1000),
  follow_up    date,
  done         boolean not null default false,
  author       uuid default auth.uid(),
  author_email text not null default coalesce(auth.jwt() ->> 'email', ''),
  created_at   timestamptz not null default now()
);
create index if not exists store_notes_store on public.store_notes (store_id, created_at desc);
create index if not exists store_notes_follow on public.store_notes (follow_up) where not done and follow_up is not null;
alter table public.store_notes enable row level security;
drop policy if exists store_notes_read on public.store_notes;
create policy store_notes_read on public.store_notes for select to authenticated using (public.is_admin());
drop policy if exists store_notes_insert on public.store_notes;
create policy store_notes_insert on public.store_notes for insert to authenticated with check (public.is_admin() and author = auth.uid());
drop policy if exists store_notes_update on public.store_notes;
create policy store_notes_update on public.store_notes for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists store_notes_delete on public.store_notes;
create policy store_notes_delete on public.store_notes for delete to authenticated using (public.is_superadmin() or author = auth.uid());
revoke all on public.store_notes from anon;
revoke update on public.store_notes from authenticated;   -- Supabase grants everything on new tables by default
grant select, insert, delete on public.store_notes to authenticated;
grant update (done, follow_up) on public.store_notes to authenticated;   -- a note's text never changes once written

-- the activity log now also names payments and notes
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
    when 'store_payments' then coalesce(rw ->> 'amount', '') || ' درهم · حتى ' || coalesce(rw ->> 'paid_until', '')
    when 'store_notes' then left(coalesce(rw ->> 'body', ''), 120)
    else '' end;
  if tg_op = 'INSERT' and tg_table_name in ('perfumes', 'stores', 'store_payments', 'store_notes') then d := jsonb_build_object('new', n - 'created_at'); end if;
  insert into activity_log (actor, actor_email, actor_role, action, store_id, target, detail)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''), r, tg_table_name || '.' || lower(tg_op), sid, left(tgt, 200), d);
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['store_payments', 'store_notes'] loop
    execute format('drop trigger if exists ff_log on public.%I', t);
    execute format('create trigger ff_log after insert or update or delete on public.%I for each row execute function public.ff_log()', t);
  end loop;
end $$;
