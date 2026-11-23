-- RihaFlow · resserrer qui lit le catalogue et combien on peut ecrire d'evenements.
-- A coller dans SQL Editor → Run (apres 026). Peut etre relance sans risque.
--
-- 1) perfumes_read  avant: «tout compte connecte lit les 1740 parfums». Un compte suffisait donc a
--    recopier la base. Maintenant il faut etre lie a une boutique (ou etre de l'equipe).
-- 2) record_event   la limite ne tenait qu'au numero de visite, choisi par l'appelant: en changeant de
--    numero on pouvait remplir la table. On ajoute une limite par boutique et une limite d'ensemble.

-- ───────────── 1. le catalogue ─────────────
-- · visiteur: seulement les parfums qu'une boutique en ligne vend (ce dont le quiz a besoin)
-- · marchand lie a une boutique: tout le catalogue actif, pour chercher et ajouter ses parfums
-- · equipe: tout
drop policy if exists perfumes_read on public.perfumes;
create policy perfumes_read on public.perfumes for select using (
  public.is_admin()
  or (active and exists (select 1 from public.store_members m where m.user_id = auth.uid()))
  or (active and exists (select 1 from public.offers o
                         where o.perfume_id = perfumes.perfume_id and o.active and public.store_is_live(o.store_id))));

-- ───────────── 2. les evenements du quiz ─────────────
create index if not exists events_store_ts_idx on public.events (store_id, ts);
create index if not exists events_ts_idx on public.events (ts);

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
  -- trois limites: la visite (comme avant), la boutique, et l'ensemble du service.
  -- Le numero de visite vient du navigateur: seules les deux dernieres tiennent face a quelqu'un qui en change.
  if (select count(*) from events where visit = v and ts > now() - interval '1 hour') >= 80 then return 'ignored'; end if;
  if shop <> '' and (select count(*) from events where store_id = shop and ts > now() - interval '1 hour') >= 3000 then return 'ignored'; end if;
  if (select count(*) from events where ts > now() - interval '1 hour') >= 20000 then return 'ignored'; end if;
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

-- controle: la premiere ligne doit etre 1740 pour l'equipe, et beaucoup moins pour un visiteur
select count(*) as parfums_vus_par_moi from public.perfumes;
