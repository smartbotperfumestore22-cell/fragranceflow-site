-- RihaFlow · the team renames a store from the portal (🏪 المتاجر › ✏️ تعديل).
-- Paste in SQL Editor → Run (after 016). Safe to run again.
-- Merchants cannot change their store's name (it stays with RihaFlow); admins and agents can, through this
-- function only. The change is written in the activity log (016) like any other team change.
-- The merchant's login email is changed by Apps Script (action changeEmail, admin only), not here.

create or replace function public.rename_store(p_store text, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); s stores;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'forbidden'); end if;   -- anyone in the team
  if length(v) < 2 or length(v) > 80 then return jsonb_build_object('error', 'name'); end if;
  update stores set name = v where id = p_store returning * into s;
  if s.id is null then return jsonb_build_object('error', 'store'); end if;
  return jsonb_build_object('ok', true, 'name', s.name);
end $$;
revoke all on function public.rename_store(text, text) from public, anon;
grant execute on function public.rename_store(text, text) to authenticated;
