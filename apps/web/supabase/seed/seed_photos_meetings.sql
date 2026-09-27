-- Seed for the photo-consent and office-meeting flows.
-- Run after seed.sql.

begin;

-- Every photo carries a blurred derivative. The original path is never
-- reachable from a client; the blurred one is what people see.
insert into photos (user_id, storage_path, blurred_path, ordinal, is_primary, approved, blur_generated_at) values
  ('11111111-1111-1111-1111-111111111111','orig/amira/0.jpg','blur/amira/0.jpg',0,true, true, now()),
  ('11111111-1111-1111-1111-111111111111','orig/amira/1.jpg','blur/amira/1.jpg',1,false,true, now()),
  ('22222222-2222-2222-2222-222222222222','orig/yousef/0.jpg','blur/yousef/0.jpg',0,true, true, now()),
  ('44444444-4444-4444-4444-444444444444','orig/lina/0.jpg','blur/lina/0.jpg',0,true, true, now()),
  ('66666666-6666-6666-6666-666666666666','orig/tareq/0.jpg','blur/tareq/0.jpg',0,true, true, now());

-- A reviewer account of its own, not one of the members. Reviewers read
-- private photos and ID documents; giving that console to an account that
-- is also dating on the platform is how a scandal starts.
insert into auth.users (id) values ('dddddddd-dddd-dddd-dddd-dddddddddddd')
on conflict do nothing;

insert into admin_users (id, email, full_name, role)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd','reviewer@nasib.app','مراجِعة','reviewer')
on conflict (id) do nothing;

insert into offices (id, name, city, address, timezone, notes) values
  ('aaaa0000-0000-0000-0000-00000000aaaa','مكتب رام الله','Ramallah',
   'شارع الإرسال، عمارة الأمل، الطابق الثالث','Asia/Hebron',
   'مدخل مستقل، موقف سيارات في الخلف'),
  ('bbbb0000-0000-0000-0000-00000000bbbb','مكتب عمّان','Amman',
   'شارع مكة، مجمع الحسين، الطابق الثاني','Asia/Amman',
   'مصعد، غرفة انتظار منفصلة للعائلات');

-- Staffed appointment slots. Capacity 1: the room is theirs.
insert into office_slots (office_id, starts_at, ends_at, capacity, staff_name, room) values
  ('aaaa0000-0000-0000-0000-00000000aaaa', now() + interval '3 days',  now() + interval '3 days 1 hour',  1, 'أم محمد', 'غرفة 1'),
  ('aaaa0000-0000-0000-0000-00000000aaaa', now() + interval '4 days',  now() + interval '4 days 1 hour',  1, 'أم محمد', 'غرفة 1'),
  ('aaaa0000-0000-0000-0000-00000000aaaa', now() + interval '5 days',  now() + interval '5 days 1 hour',  1, 'أبو خالد', 'غرفة 2'),
  ('bbbb0000-0000-0000-0000-00000000bbbb', now() + interval '6 days',  now() + interval '6 days 1 hour',  1, 'أم سامي', 'غرفة 1'),
  -- A slot already in the past, so the tests have something real to refuse.
  ('aaaa0000-0000-0000-0000-00000000aaaa', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 1, 'أم محمد', 'غرفة 1');

-- A slot that is already fully booked, for the same reason.
insert into office_slots (office_id, starts_at, ends_at, capacity, booked_count, staff_name, room)
values ('bbbb0000-0000-0000-0000-00000000bbbb', now() + interval '7 days',
        now() + interval '7 days 1 hour', 1, 1, 'أم سامي', 'غرفة 3');

commit;
