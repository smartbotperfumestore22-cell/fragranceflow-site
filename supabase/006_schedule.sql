-- FragranceFlow · Phase 2: compute the daily numbers in Supabase every night, and once now for the past days.
-- Run AFTER 005_events.sql and AFTER the Sheet's events were copied (menu ⬆️ Supabase: نقل الأحداث).
-- If the first line fails: Supabase → Database → Extensions → enable "pg_cron", then run the file again.
create extension if not exists pg_cron with schema pg_catalog;

-- every night at 02:15 (UTC): yesterday and the day before (the day before catches late events)
select cron.schedule('ff-daily-stats', '15 2 * * *',
  $$select public.rebuild_daily_stats((now() at time zone 'Africa/Casablanca')::date - 2, (now() at time zone 'Africa/Casablanca')::date - 1)$$);

-- now: every day since the launch, up to yesterday
select public.rebuild_daily_stats(date '2026-10-26', (now() at time zone 'Africa/Casablanca')::date - 1) as rows_written;

-- check
select day, store_id, metric, sum(value) from public.daily_stats where dimension = 'all' group by 1, 2, 3 order by 1, 2, 3;
