-- RihaFlow · the weekly report in the merchant portal, with one optional question before it:
-- «how many of the customers who pressed WhatsApp from the quiz really bought?»
-- Paste in SQL Editor → Run (after 020). Safe to run again.
--
-- The week is Monday to Sunday (Casablanca). The answer is the merchant's own count: we never see the sales,
-- so every figure built on it says «حسب التاجر». Aggregates only, no customer data.

create table if not exists public.store_week_sales (
  store_id    text not null references public.stores (id) on delete cascade,
  week_start  date not null check (extract(isodow from week_start) = 1),
  chats       int not null default 0 check (chats >= 0),          -- customers who pressed WhatsApp that week, when the answer was given
  sales       int check (sales between 0 and 1000),                -- null with «I don't know»
  unknown     boolean not null default false,
  answered_at timestamptz not null default now(),
  answered_by uuid default auth.uid(),
  primary key (store_id, week_start)
);
alter table public.store_week_sales enable row level security;
drop policy if exists store_week_sales_rw on public.store_week_sales;
create policy store_week_sales_rw on public.store_week_sales for all to authenticated
  using (public.is_member(store_id) or public.is_admin()) with check (public.is_member(store_id) or public.is_admin());
revoke all on public.store_week_sales from anon;
grant select, insert, update on public.store_week_sales to authenticated;

-- the statistics of any range of days (same shape as stats_json; the previous range has the same length)
create or replace function public.stats_range(s text, d_from date, d_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  start date := date '2026-10-26';
  today date := (now() at time zone 'Africa/Casablanca')::date;
  v_from date; v_to date; prev_from date; prev_to date; first date; last date; n int; mon text := ''; st record; out jsonb;
begin
  select id, name, logo_url, color into st from stores where id = s;
  if not found then return jsonb_build_object('error', 'invalid'); end if;
  if d_from is null or d_to is null or d_to < d_from or d_to < start or d_from > today then return jsonb_build_object('error', 'range'); end if;
  first := d_from;
  v_from := greatest(d_from, start); v_to := least(d_to, today);
  prev_from := d_from - (d_to - d_from + 1); prev_to := d_from - 1;

  with lines as (
    select d.day, d.metric, d.dimension, d.value from daily_stats d where d.store_id = s and d.day between v_from and v_to and d.day < today
    union all
    select c.day, c.metric, c.dimension, c.value from public.compute_stats(today, today) c where v_to = today and c.store_id = s
  ),
  days as (select g::date as day from generate_series(v_from, v_to, interval '1 day') g),
  dims as (select metric, dimension, sum(value)::int v from lines where dimension <> 'all' group by 1, 2),
  perf as (
    select coalesce(p.dimension, w.dimension) id, coalesce(p.v, 0) shown, coalesce(w.v, 0) wa
    from (select dimension, v from dims where metric = 'perfume') p
    full join (select dimension, v from dims where metric = 'whatsapp_perfume') w on w.dimension = p.dimension
  )
  select jsonb_build_object(
    'store', jsonb_build_object('id', st.id, 'name', st.name,
      'logo', case when st.logo_url ~ '^https://' then st.logo_url else '' end,
      'color', case when st.color ~* '^#[0-9a-f]{6}$' then st.color else '' end),
    'from', v_from, 'to', v_to,
    'days', (select jsonb_agg(to_char(day, 'YYYY-MM-DD') order by day) from days),
    'series', (select jsonb_object_agg(m, (select jsonb_agg(coalesce((select sum(l.value) from lines l where l.day = d.day and l.metric = m and l.dimension = 'all'), 0) order by d.day) from days d))
               from unnest(array['experiences', 'completed', 'whatsapp', 'shares']) m),
    'totals', coalesce((select jsonb_object_agg(metric, v) from (select metric, sum(value)::int v from lines where dimension = 'all' group by 1) t), '{}'::jsonb),
    'month', mon,
    'months', (select jsonb_agg(to_char(g, 'YYYY-MM') order by g desc) from generate_series(date_trunc('month', start), date_trunc('month', today), interval '1 month') g),
    'partial', case when mon = '' then false else (v_to = today or v_from > first) end,
    'prev', case when prev_from >= start then coalesce((select jsonb_object_agg(metric, v) from (
              select metric, sum(value)::int v from daily_stats where store_id = s and dimension = 'all' and day between prev_from and prev_to and day >= start group by 1) t), '{}'::jsonb) end,
    'source', coalesce((select jsonb_object_agg(dimension, v) from dims where metric = 'source'), '{}'::jsonb),
    'family', coalesce((select jsonb_object_agg(dimension, v) from dims where metric = 'family'), '{}'::jsonb),
    'impression', coalesce((select jsonb_object_agg(dimension, v) from dims where metric = 'impression'), '{}'::jsonb),
    'gender', coalesce((select jsonb_object_agg(dimension, v) from dims where metric = 'gender'), '{}'::jsonb),
    'perfumes', coalesce((select jsonb_agg(x order by (x->>'shown')::int desc, (x->>'whatsapp')::int desc) from (
        select jsonb_build_object('id', perf.id, 'name', coalesce(nullif(f.name, ''), perf.id), 'brand', coalesce(f.brand, ''),
               'image', case when f.image_url ~ '^https://' then f.image_url else '' end, 'shown', perf.shown, 'whatsapp', perf.wa) x
        from perf left join perfumes f on upper(f.perfume_id) = upper(perf.id)
        order by perf.shown desc, perf.wa desc limit 10) top), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.stats_range(text, date, date) from public, anon, authenticated;

-- one week of a store (last week by default) with the merchant's answer, for the portal
create or replace function public.store_week(p_store text, p_week date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Africa/Casablanca')::date;
  w date := coalesce(p_week, date_trunc('week', today)::date - 7);
  res jsonb; a store_week_sales;
begin
  if not (public.is_member(p_store) or public.is_admin()) then return jsonb_build_object('error', 'invalid'); end if;
  w := date_trunc('week', w)::date;
  res := public.stats_range(p_store, w, w + 6);
  if res ? 'error' then return res; end if;
  select * into a from store_week_sales where store_id = p_store and week_start = w;
  return res || jsonb_build_object('week', w, 'week_end', w + 6,
    'answer', case when a.store_id is null then null else jsonb_build_object('chats', a.chats, 'sales', a.sales, 'unknown', a.unknown, 'at', a.answered_at) end);
end $$;
revoke all on function public.store_week(text, date) from public, anon;
grant execute on function public.store_week(text, date) to authenticated;
