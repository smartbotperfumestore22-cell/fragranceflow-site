-- FragranceFlow · several sizes per perfume for a store (decants 3ml, 5ml, 10ml… and full bottles), each with its price.
-- One offer row per perfume keeps everything else as it is: price = the cheapest size, size_type = full / decant / both,
-- size = the list of sizes. Paste in SQL Editor → Run. Safe to run again.
alter table public.offers add column if not exists variants jsonb not null default '[]'::jsonb;
alter table public.offers drop constraint if exists offers_variants_shape;
alter table public.offers add constraint offers_variants_shape check (jsonb_typeof(variants) = 'array' and jsonb_array_length(variants) <= 12);

create or replace function public.offers_variants() returns trigger
language plpgsql set search_path = public as $$
declare v jsonb; seen text[] := '{}'; k text;
begin
  if jsonb_array_length(new.variants) = 0 then return new; end if;
  for v in select * from jsonb_array_elements(new.variants) loop
    if jsonb_typeof(v) <> 'object' or coalesce(v->>'type', '') not in ('full', 'decant')
       or length(coalesce(v->>'size', '')) not between 1 and 20
       or coalesce(v->>'price', '') !~ '^[0-9]+(\.[0-9]+)?$' or (v->>'price')::numeric > 100000 then
      raise exception 'size not valid: %', v::text;
    end if;
    k := (v->>'type') || '|' || lower(v->>'size');
    if k = any(seen) then raise exception 'the same size twice: %', v->>'size'; end if;
    seen := seen || k;
  end loop;
  -- cheapest first, full bottles after decants of the same price
  new.variants := (select jsonb_agg(jsonb_build_object('type', x->>'type', 'size', trim(x->>'size'), 'price', (x->>'price')::numeric)
                   order by (x->>'price')::numeric, x->>'type' desc) from jsonb_array_elements(new.variants) x);
  new.price := (select min((x->>'price')::numeric) from jsonb_array_elements(new.variants) x);
  new.size_type := case
    when not exists (select 1 from jsonb_array_elements(new.variants) x where x->>'type' = 'full') then 'decant'
    when not exists (select 1 from jsonb_array_elements(new.variants) x where x->>'type' = 'decant') then 'full'
    else 'both' end;
  new.size := (select string_agg(x->>'size', ' / ' order by (x->>'price')::numeric) from jsonb_array_elements(new.variants) x);
  return new;
end $$;
-- named so it runs before offers_guard (triggers run in name order), so the change log sees the final row
drop trigger if exists offers_variants on public.offers;
drop trigger if exists offers_0_variants on public.offers;
create trigger offers_0_variants before insert or update of variants on public.offers for each row execute function public.offers_variants();

grant update (variants) on public.offers to authenticated;
