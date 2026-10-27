-- FragranceFlow · link a merchant login to its store.
-- 1) Authentication → Users → Add user → Create new user: the merchant's email + a temporary password,
--    tick "Auto Confirm User". Send them the password; they can change it with «نسيتي كلمة السر؟».
-- 2) Replace the two values below and run.
insert into public.store_members (user_id, store_id)
select id, 'STORE_ID_HERE' from auth.users where email = 'MERCHANT_EMAIL_HERE'
on conflict do nothing;

-- check: who is linked to which store
select u.email, m.store_id, m.role from public.store_members m join auth.users u on u.id = m.user_id order by m.store_id;
