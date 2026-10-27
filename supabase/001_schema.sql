-- FragranceFlow · Supabase phase 1: merchant accounts, catalogue, requests, trial.
-- Events and Daily_Stats stay in Google Sheets for now.
-- Paste this whole file in Supabase → SQL Editor → Run. Safe to run again (it only creates what is missing).

-- ───────────── tables ─────────────
create table if not exists public.stores (
  id                  text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,40}$'),   -- same id as in the Sheet (ada-parfum, demo…)
  name                text not null,
  city                text default '',
  website             text default '',
  whatsapp            text default '',
  instagram           text default '',
  logo_url            text default '',
  color               text default '',
  active              boolean not null default true,
  subscription_status text not null default 'trial' check (subscription_status in ('trial', 'active', 'paused', 'cancelled')),
  trial_started_at    timestamptz default now(),
  trial_ends_at       timestamptz default (now() + interval '7 days'),
  created_at          timestamptz not null default now()
);

-- same columns as the Perfumes tab, so the quiz engine reads exactly what it reads today
create table if not exists public.perfumes (
  perfume_id    text primary key check (perfume_id ~ '^FF-[0-9]{4,}$'),
  name          text not null,
  brand         text not null default '',
  gender        text not null default 'unisex',
  character     text default '',
  occasion      text default '',
  season        text default '',
  notes_top     text default '',
  notes_mid     text default '',
  notes_base    text default '',
  concentration text default '',
  size          text default '',
  size_type     text default 'full',
  ref_price     numeric,
  world         text default '',
  image_key     text default '',
  image_url     text default '',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.offers (
  id          bigint generated always as identity primary key,
  store_id    text not null references public.stores (id) on delete cascade,
  perfume_id  text not null references public.perfumes (perfume_id),
  size        text default '',
  size_type   text default 'full',
  price       numeric check (price is null or price >= 0),
  url         text default '',
  in_stock    boolean not null default true,
  active      boolean not null default true,      -- false = the merchant removed it (kept for history)
  updated_at  timestamptz not null default now(),
  unique (store_id, perfume_id)
);

-- which login belongs to which store
create table if not exists public.store_members (
  user_id    uuid not null references auth.users (id) on delete cascade,
  store_id   text not null references public.stores (id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner')),
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);

-- the FragranceFlow team (you)
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- a merchant asks for a perfume that is not in the catalogue yet
create table if not exists public.requests (
  id           bigint generated always as identity primary key,
  store_id     text not null references public.stores (id) on delete cascade,
  perfume_name text not null check (length(perfume_name) between 2 and 120),
  brand        text not null default '' check (length(brand) <= 80),
  size         text default '' check (length(size) <= 40),
  price        numeric check (price is null or price >= 0),
  note         text default '' check (length(note) <= 500),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note   text default '',
  perfume_id   text references public.perfumes (perfume_id),   -- filled when approved
  requested_by uuid default auth.uid() references auth.users (id),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);

-- every change a merchant makes to an offer (price, stock, removal), so it can be checked or undone
create table if not exists public.offer_changes (
  id         bigint generated always as identity primary key,
  offer_id   bigint,
  store_id   text not null,
  perfume_id text not null,
  changed_by uuid,
  old_row    jsonb,
  new_row    jsonb,
  changed_at timestamptz not null default now()
);

create index if not exists offers_store_idx on public.offers (store_id);
create index if not exists requests_store_idx on public.requests (store_id, status);
create index if not exists offer_changes_store_idx on public.offer_changes (store_id, changed_at desc);
create index if not exists store_members_store_idx on public.store_members (store_id);

-- ───────────── helpers ─────────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.is_member(s text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.store_members where user_id = auth.uid() and store_id = s);
$$;

-- a store is shown to customers only when active and its trial or subscription is valid
create or replace function public.store_is_live(s text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.stores
    where id = s and active
      and (subscription_status = 'active' or (subscription_status = 'trial' and (trial_ends_at is null or trial_ends_at > now())))
  );
$$;

-- merchants may only change price, stock, size, url and active on their offers; the rest is locked
create or replace function public.offers_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if not public.is_admin() and (new.store_id <> old.store_id or new.perfume_id <> old.perfume_id) then
      raise exception 'store_id and perfume_id cannot be changed';
    end if;
    new.updated_at := now();
  end if;
  if auth.uid() is null then return new; end if;   -- Sheet import / server: not a merchant change
  insert into public.offer_changes (offer_id, store_id, perfume_id, changed_by, old_row, new_row)
  values (new.id, new.store_id, new.perfume_id, auth.uid(),
          case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;
drop trigger if exists offers_guard on public.offers;
create trigger offers_guard before update on public.offers for each row execute function public.offers_guard();
drop trigger if exists offers_log_insert on public.offers;
create or replace function public.offers_log_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then   -- merchant/admin added it from the portal (not the Sheet import)
    insert into public.offer_changes (offer_id, store_id, perfume_id, changed_by, old_row, new_row)
    values (new.id, new.store_id, new.perfume_id, auth.uid(), null, to_jsonb(new));
  end if;
  return new;
end $$;
create trigger offers_log_insert after insert on public.offers for each row execute function public.offers_log_insert();

-- merchants cannot approve their own requests
create or replace function public.requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then
      new.status := 'pending'; new.admin_note := ''; new.perfume_id := null; new.reviewed_at := null; new.requested_by := auth.uid();
    else
      raise exception 'only FragranceFlow can review requests';
    end if;
  elsif tg_op = 'UPDATE' and new.status <> old.status then
    new.reviewed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists requests_guard on public.requests;
create trigger requests_guard before insert or update on public.requests for each row execute function public.requests_guard();

-- ───────────── row level security ─────────────
alter table public.stores        enable row level security;
alter table public.perfumes      enable row level security;
alter table public.offers        enable row level security;
alter table public.store_members enable row level security;
alter table public.admins        enable row level security;
alter table public.requests      enable row level security;
alter table public.offer_changes enable row level security;

-- clear old versions of the policies so the file can be run again
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('stores','perfumes','offers','store_members','admins','requests','offer_changes') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- perfumes: the catalogue is public (it is what the quiz shows); only admins write
create policy perfumes_read  on public.perfumes for select using (active or public.is_admin());
create policy perfumes_admin on public.perfumes for all using (public.is_admin()) with check (public.is_admin());

-- stores: customers see live stores; a merchant sees its own; admins everything
create policy stores_read  on public.stores for select using (public.store_is_live(id) or public.is_member(id) or public.is_admin());
create policy stores_admin on public.stores for all using (public.is_admin()) with check (public.is_admin());

-- offers: customers see active offers of live stores; a merchant reads, adds and edits only its own; no deleting (set active = false)
create policy offers_read   on public.offers for select using ((active and public.store_is_live(store_id)) or public.is_member(store_id) or public.is_admin());
create policy offers_insert on public.offers for insert with check (public.is_member(store_id) or public.is_admin());
create policy offers_update on public.offers for update using (public.is_member(store_id) or public.is_admin()) with check (public.is_member(store_id) or public.is_admin());
create policy offers_delete on public.offers for delete using (public.is_admin());

-- memberships and admins: read your own row; only admins manage
create policy members_read  on public.store_members for select using (user_id = auth.uid() or public.is_admin());
create policy members_admin on public.store_members for all using (public.is_admin()) with check (public.is_admin());
create policy admins_read   on public.admins for select using (user_id = auth.uid());

-- requests: a merchant sends and sees its own; admins review
create policy requests_read   on public.requests for select using (public.is_member(store_id) or public.is_admin());
create policy requests_insert on public.requests for insert with check (public.is_member(store_id) or public.is_admin());
create policy requests_admin  on public.requests for update using (public.is_admin()) with check (public.is_admin());

-- change log: a merchant reads its own history; written only by the trigger
create policy changes_read on public.offer_changes for select using (public.is_member(store_id) or public.is_admin());

-- column-level limits for logged-in merchants on offers (admins go through the same grants, which is enough for the portal)
revoke update on public.offers from anon, authenticated;
grant update (price, in_stock, active, size, size_type, url) on public.offers to authenticated;
revoke insert, update, delete on public.perfumes, public.stores, public.store_members, public.admins, public.offer_changes from anon;
revoke insert, update, delete on public.requests, public.offers from anon;
