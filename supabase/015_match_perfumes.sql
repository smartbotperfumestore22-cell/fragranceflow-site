-- RihaFlow · match a merchant's list of perfumes against the catalogue (portal → «📥 استيراد لائحة»).
-- Paste in SQL Editor → Run (after 011, which adds ff_fold). Safe to run again.
--
-- For each line the merchant pasted (name, brand, maybe size and price, written any way), returns the three
-- closest perfumes of the catalogue with a score from 0 to 1. Nothing is written here: the portal shows the
-- matches, the merchant confirms, and only then the offers are added (with the usual rules and RLS).

-- the words that identify a perfume in a text: lower case, no accents, «j'adore» = «jadore»; without sizes,
-- concentrations and filler words (numbers that are part of a name, like «540», are kept)
create or replace function public.ff_words(t text) returns text[]
language sql immutable parallel safe set search_path = public as $$
  select coalesce(array_agg(distinct w), '{}') from unnest(regexp_split_to_array(
    regexp_replace(regexp_replace(ff_fold(t), '[''’`´]', '', 'g'), '[^a-z0-9؀-ۿ]+', ' ', 'g'), '\s+')) w
  where length(w) >= 2 and w !~ '^[0-9]+(ml|dh|mad|g)$'
    and w <> all (array['ml', 'dh', 'mad', 'dhs', 'edp', 'edt', 'edc', 'eau', 'de', 'di', 'du', 'la', 'le', 'les', 'parfum', 'perfume', 'extrait',
                        'toilette', 'cologne', 'spray', 'by', 'for', 'the', 'and', 'et', 'vapo', 'vaporisateur', 'tester', 'decant', 'decants'])
$$;
grant execute on function public.ff_words(text) to authenticated;

create or replace function public.match_perfumes(p_items text[])
returns jsonb language sql stable security invoker set search_path = public as $$
  with items as (
    select i, left(coalesce(t, ''), 200) as line from unnest(p_items[1:300]) with ordinality u(t, i)
  ),
  q as (select i, line, ff_words(line) as words from items),
  cat as (select perfume_id, name, brand, image_url, ff_words(brand || ' ' || name) as all_w, ff_words(name) as name_w from perfumes where active),
  scored as (
    -- score: how much of the line is found in the perfume (75%) and how much of the perfume's own name is in the line (25%)
    select q.i, c.perfume_id, c.name, c.brand, c.image_url,
           round((0.75 * cardinality(array(select unnest(q.words) intersect select unnest(c.all_w)))::numeric / greatest(cardinality(q.words), 1)
                + 0.25 * cardinality(array(select unnest(c.name_w) intersect select unnest(q.words)))::numeric / greatest(cardinality(c.name_w), 1)), 3) as score
    from q join cat c on c.all_w && q.words
    where cardinality(q.words) > 0
  ),
  ranked as (
    select *, row_number() over (partition by i order by score desc, length(name), name) as rk from scored
  )
  select coalesce(jsonb_agg(jsonb_build_object('i', q.i, 'line', q.line, 'candidates', coalesce((
      select jsonb_agg(jsonb_build_object('perfume_id', r.perfume_id, 'name', r.name, 'brand', r.brand,
             'image', case when r.image_url ~ '^https://' then r.image_url else '' end, 'score', r.score) order by r.rk)
      from ranked r where r.i = q.i and r.rk <= 3 and r.score >= 0.3), '[]'::jsonb)) order by q.i), '[]'::jsonb)
  from q
$$;
revoke all on function public.match_perfumes(text[]) from public, anon;
grant execute on function public.match_perfumes(text[]) to authenticated;
