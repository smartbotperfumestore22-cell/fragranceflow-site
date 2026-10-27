-- FragranceFlow · run AFTER the first import from the Sheet (menu ⬆️ Supabase).
-- 1) The demo store and the stores already working with you should not expire after 7 days.
update public.stores set subscription_status = 'active', trial_ends_at = null where id in ('demo', 'ada-parfum');

-- 2) Make your own login an admin. First create it in Authentication → Users → Add user,
--    then replace the email below with yours and run this line.
insert into public.admins (user_id)
select id from auth.users where email = 'YOUR_EMAIL_HERE'
on conflict do nothing;

-- check
select id, name, subscription_status, trial_ends_at from public.stores order by id;
select count(*) as perfumes from public.perfumes;
select store_id, count(*) as offers from public.offers group by store_id order by store_id;
