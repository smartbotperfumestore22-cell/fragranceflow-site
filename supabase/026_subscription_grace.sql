-- RihaFlow · l'abonnement a une fin, et une grace de 48 heures.
-- A coller dans SQL Editor → Run (apres 019 et 025). Peut etre relance sans risque.
--
-- stores.paid_until   le dernier jour couvert, recopie depuis store_payments (le marchand le voit, pas les montants)
-- stores.sub_ends_at  l'instant exact ou la periode payee se termine: minuit a Casablanca, le lendemain
-- store_is_live       un abonnement «active» reste visible jusqu'a sub_ends_at + 48 h, puis s'arrete seul
--
-- Une boutique «active» sans aucun paiement enregistre garde paid_until = null et reste visible comme avant:
-- rien ne s'arrete tant que l'equipe n'a pas commence a saisir les paiements.

alter table public.stores
  add column if not exists paid_until  date,
  add column if not exists sub_ends_at timestamptz;

comment on column public.stores.paid_until  is 'dernier jour couvert par un paiement (lecture seule, calcule)';
comment on column public.stores.sub_ends_at is 'fin de la periode payee, minuit a Casablanca (lecture seule, calcule)';

-- ───────────── la date de fin suit les paiements ─────────────
create or replace function public.store_dates_refresh(s text) returns void
language plpgsql security definer set search_path = public as $$
declare p date;
begin
  select max(paid_until) into p from store_payments where store_id = s;
  update stores set
    paid_until  = p,
    sub_ends_at = case when p is null then null
                       else ((p + 1)::timestamp) at time zone 'Africa/Casablanca' end
  where id = s;
end $$;

create or replace function public.store_payments_dates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' then perform public.store_dates_refresh(old.store_id); end if;
  if tg_op <> 'DELETE' then perform public.store_dates_refresh(new.store_id); end if;
  return null;
end $$;

drop trigger if exists store_payments_dates on public.store_payments;
create trigger store_payments_dates after insert or update or delete on public.store_payments
  for each row execute function public.store_payments_dates();

-- les paiements deja saisis
do $$ declare s text; begin
  for s in select distinct store_id from store_payments loop
    perform public.store_dates_refresh(s);
  end loop;
end $$;

-- ───────────── la boutique s'arrete 48 h apres la fin ─────────────
create or replace function public.store_is_live(s text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.stores
    where id = s and active
      and (
        (subscription_status = 'active'
          and (sub_ends_at is null or now() < sub_ends_at + interval '48 hours'))
        or (subscription_status = 'trial'
          and (trial_ends_at is null or trial_ends_at > now()))
      )
  );
$$;

-- ces deux colonnes sont calculees: ni le marchand ni l'agent ne les ecrivent
create or replace function public.ff_stores_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.team_role() is distinct from 'agent' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'agent_forbidden: only an admin can remove a store' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then
    new.subscription_status := 'trial'; new.trial_started_at := now(); new.trial_ends_at := now() + interval '7 days'; new.active := true;
    new.paid_until := null; new.sub_ends_at := null;
  elsif new.subscription_status is distinct from old.subscription_status or new.trial_ends_at is distinct from old.trial_ends_at
     or new.trial_started_at is distinct from old.trial_started_at or new.active is distinct from old.active
     or new.paid_until is distinct from old.paid_until or new.sub_ends_at is distinct from old.sub_ends_at then
    raise exception 'agent_forbidden: only an admin can change the subscription' using errcode = '42501';
  end if;
  return new;
end $$;

-- ───────────── ce que l'equipe voit venir ─────────────
-- les abonnements payants qui se terminent dans les 7 jours, et ceux qui sont dans les 48 h de grace
create or replace function public.subs_ending() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'ends'), '[]'::jsonb) from (
    select jsonb_build_object(
      'store', name, 'id', id,
      'ends', to_char(paid_until, 'YYYY-MM-DD'),
      'hours_left', greatest(0, floor(extract(epoch from (sub_ends_at + interval '48 hours' - now())) / 3600))::int,
      'grace', now() >= sub_ends_at) x
    from stores
    where public.is_admin()
      and active and subscription_status = 'active' and sub_ends_at is not null
      and now() >= sub_ends_at - interval '7 days'
      and now() < sub_ends_at + interval '48 hours'
  ) t;
$$;
revoke all on function public.subs_ending() from public, anon;
grant execute on function public.subs_ending() to authenticated;
