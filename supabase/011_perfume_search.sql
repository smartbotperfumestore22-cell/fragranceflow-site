-- FragranceFlow · search the perfumes catalogue from the portal (ready for thousands of perfumes).
-- Paste in SQL Editor → Run. Safe to run again.
--
-- Why: Supabase returns at most 1000 rows per request, so loading the whole catalogue in the portal
-- would silently stop at 1000. The portal now asks for one page of results matching what is typed.
-- Row-level security still applies: merchants see active perfumes, the FragranceFlow team sees all.

-- lower case, accents removed ("Giò" finds "gio"), so a search matches however the name is typed
create or replace function public.ff_fold(t text) returns text
language sql immutable parallel safe set search_path = public as $$
  select translate(lower(coalesce(t, '')),
    'àáâãäåāèéêëēìíîïīòóôõöøōùúûüūçñýÿœæ',
    'aaaaaaaeeeeeiiiiiooooooouuuuucnyyoa')
$$;

-- one page of perfumes matching every typed word (in the name, the brand or the id), brand then name;
-- total = how many match in all, for «X عطر» and «عرض المزيد»
create or replace function public.search_perfumes(q text default '', only_active boolean default true, lim int default 30, off int default 0)
returns table (p jsonb, total bigint)
language sql stable security invoker set search_path = public as $$
  with w as (
    select coalesce(array_agg(replace(replace(replace(x, '\', '\\'), '%', '\%'), '_', '\_')), '{}') as words
    from unnest(regexp_split_to_array(ff_fold(left(q, 80)), '\s+')) x where x <> ''
  ),
  hits as (
    select pf.* from perfumes pf, w
    where (not only_active or pf.active)
      and (select coalesce(bool_and(ff_fold(pf.name || ' ' || pf.brand || ' ' || pf.perfume_id) like '%' || x || '%'), true) from unnest(w.words) x)
  )
  select to_jsonb(h), count(*) over () from hits h
  order by h.brand, h.name, h.perfume_id
  limit least(greatest(coalesce(lim, 30), 1), 100) offset greatest(coalesce(off, 0), 0)
$$;

revoke all on function public.search_perfumes(text, boolean, int, int) from public, anon;
grant execute on function public.search_perfumes(text, boolean, int, int) to authenticated;
grant execute on function public.ff_fold(text) to authenticated;
