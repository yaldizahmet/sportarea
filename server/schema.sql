-- SporArea veritabanı şeması (Supabase / Postgres)
-- Shajka projesinin içinde, ondan tamamen ayrı "sportarea" şemasında durur.
-- Tablo ve kolon adları eski SQLite sürümüyle aynıdır (tırnaklı camelCase),
-- böylece API'nin döndürdüğü JSON alanları değişmez.

create schema if not exists sportarea;

create table sportarea."User" (
  id text primary key,
  name text not null,
  email text not null,
  password text not null,
  role text not null default 'PLAYER',
  avatar text,
  position text default 'Orta Saha',
  "createdAt" timestamptz not null default now()
);
create unique index user_email_lower_uniq on sportarea."User" (lower(email));

create table sportarea."Groups" (
  id text primary key,
  name text not null,
  "inviteCode" text not null unique,
  "creatorId" text references sportarea."User"(id) on delete set null,
  -- Haftalık otomatik maç (hepsi boşsa kapalı). weeklyDay: 0=Pazar ... 6=Cumartesi.
  -- 06:00'dan önceki saatler o günün gecesi sayılır (Çarşamba 00:00 = Çarşamba'yı Perşembe'ye bağlayan gece).
  "weeklyDay" integer check ("weeklyDay" between 0 and 6),
  "weeklyTime" text,
  "weeklyLocation" text,
  "weeklyMaxPlayers" integer,
  "weeklyLockoutHours" integer,
  "createdAt" timestamptz not null default now()
);

create table sportarea."GroupMembers" (
  "groupId" text not null references sportarea."Groups"(id) on delete cascade,
  "userId" text not null references sportarea."User"(id) on delete cascade,
  -- "Her hafta varım": açılan her haftalık maçta otomatik kadroya girer.
  "alwaysIn" boolean not null default false,
  "joinedAt" timestamptz not null default now(),
  primary key ("groupId", "userId")
);
create index on sportarea."GroupMembers" ("userId");

create table sportarea."Matches" (
  id text primary key,
  "groupId" text references sportarea."Groups"(id) on delete set null,
  "creatorId" text references sportarea."User"(id) on delete set null,
  date text not null,
  time text not null,
  location text not null,
  "maxPlayers" integer not null check ("maxPlayers" > 0),
  status text not null default 'OPEN',
  score text,
  "teamAName" text default 'A Takımı',
  "teamBName" text default 'B Takımı',
  "matchTimestamp" bigint not null default 0,
  "lockoutHours" integer default 1,
  "createdAt" timestamptz not null default now()
);
create index on sportarea."Matches" ("groupId");

create table sportarea."MatchPlayers" (
  "matchId" text not null references sportarea."Matches"(id) on delete cascade,
  "userId" text not null references sportarea."User"(id) on delete cascade,
  team text not null default 'UNASSIGNED',
  goals integer not null default 0,
  status text not null default 'ACTIVE',
  "joinedAt" timestamptz not null default now(),
  primary key ("matchId", "userId")
);
create index on sportarea."MatchPlayers" ("userId");

-- Bir oyuncu, bir maçta aynı kişiyi bir kez puanlar (tekrar puanlarsa güncellenir).
create table sportarea."Ratings" (
  id text primary key,
  "matchId" text not null references sportarea."Matches"(id) on delete cascade,
  "raterId" text not null references sportarea."User"(id) on delete cascade,
  "ratedId" text not null references sportarea."User"(id) on delete cascade,
  speed integer check (speed between 0 and 100),
  shoot integer check (shoot between 0 and 100),
  pass integer check (pass between 0 and 100),
  physique integer check (physique between 0 and 100),
  "createdAt" timestamptz not null default now(),
  unique ("matchId", "raterId", "ratedId")
);
create index on sportarea."Ratings" ("ratedId");

create table sportarea."Notifications" (
  id text primary key,
  "userId" text not null references sportarea."User"(id) on delete cascade,
  message text not null,
  type text not null default 'INFO',
  "isRead" boolean not null default false,
  metadata text,
  "createdAt" timestamptz not null default now()
);
create index on sportarea."Notifications" ("userId", "createdAt" desc);

-- Bir oyuncu, bir maçta tek MVP oyu kullanır.
create table sportarea."MvpVotes" (
  id text primary key,
  "matchId" text not null references sportarea."Matches"(id) on delete cascade,
  "voterId" text not null references sportarea."User"(id) on delete cascade,
  "votedId" text not null references sportarea."User"(id) on delete cascade,
  "createdAt" timestamptz not null default now(),
  unique ("matchId", "voterId")
);

-- Güvenlik: Shajka'nın tarayıcıya açık anahtarları (anon/authenticated) bu şemaya erişemez.
revoke all on schema sportarea from public, anon, authenticated;

-- Sunucunun bağlanacağı, yalnızca bu şemaya yetkili rol.
-- Şifre bilerek burada yok; Supabase SQL Editor'dan ayrıca verilir:
--   alter role sportarea_app with password '...';
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'sportarea_app') then
    create role sportarea_app login;
  end if;
end $$;
grant usage on schema sportarea to sportarea_app;
grant select, insert, update, delete on all tables in schema sportarea to sportarea_app;
alter role sportarea_app set search_path = sportarea;

-- RLS açık; yalnızca sunucu rolüne tam erişim politikası var.
do $$
declare t text;
begin
  foreach t in array array['User','Groups','GroupMembers','Matches','MatchPlayers',
                           'Ratings','Notifications','MvpVotes'] loop
    execute format('alter table sportarea.%I enable row level security', t);
    execute format('create policy server_all on sportarea.%I for all to sportarea_app using (true) with check (true)', t);
  end loop;
end $$;

-- v2: Varım / Yokum / Belki
-- "Varım" = MatchPlayers'ta kayıt (ACTIVE ya da RESERVE). Bu tablo sadece Yokum ve Belki cevaplarını tutar.
-- Hiç kaydı olmayan grup üyesi = henüz cevap vermemiş.
create table sportarea."MatchResponses" (
  "matchId" text not null references sportarea."Matches"(id) on delete cascade,
  "userId" text not null references sportarea."User"(id) on delete cascade,
  response text not null check (response in ('NO', 'MAYBE')),
  "updatedAt" timestamptz not null default now(),
  primary key ("matchId", "userId")
);
create index on sportarea."MatchResponses" ("userId");
grant select, insert, update, delete on sportarea."MatchResponses" to sportarea_app;
alter table sportarea."MatchResponses" enable row level security;
create policy server_all on sportarea."MatchResponses" for all to sportarea_app using (true) with check (true);

-- v3: Haftalık maç kolonları (Groups.weekly*) ve GroupMembers."alwaysIn" yukarıdaki tanımlara eklendi.
-- Sohbet ve müsaitlik özellikleri kaldırıldı; eski boş tablolar canlı veritabanından da silindi.

-- v4: Push bildirimleri ve zamanlayıcı
-- Her telefonun Expo push token'ı. Aynı telefon başka hesaba geçerse token o hesaba taşınır.
create table sportarea."PushTokens" (
  token text primary key,
  "userId" text not null references sportarea."User"(id) on delete cascade,
  platform text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index on sportarea."PushTokens" ("userId");

-- Maçtan 24 saat önceki hatırlatma bir kez gitsin.
alter table sportarea."Matches" add column "reminderSentAt" timestamptz;

-- Uygulama ayarları. cron_secret: pg_cron'un sunucuyu çağırırken gönderdiği gizli anahtar.
-- Sunucu da aynı değeri buradan okuyup karşılaştırıyor (Render'a ortam değişkeni eklemek gerekmiyor).
create table sportarea."AppConfig" (
  key text primary key,
  value text not null
);
insert into sportarea."AppConfig" (key, value)
values ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

grant select, insert, update, delete on sportarea."PushTokens" to sportarea_app;
grant select on sportarea."AppConfig" to sportarea_app;
alter table sportarea."PushTokens" enable row level security;
alter table sportarea."AppConfig" enable row level security;
create policy server_all on sportarea."PushTokens" for all to sportarea_app using (true) with check (true);
create policy server_read on sportarea."AppConfig" for select to sportarea_app using (true);

-- Zamanlayıcı (sadece Supabase'de; pg_cron + pg_net eklentileri gerekir):
--   create extension if not exists pg_cron;  create extension if not exists pg_net;
--   select cron.schedule('sportarea-tick', '7 * * * *', $$
--     select net.http_post(
--       url := 'https://sportarea.onrender.com/api/cron/tick',
--       headers := jsonb_build_object('Content-Type', 'application/json',
--                    'x-cron-secret', (select value from sportarea."AppConfig" where key = 'cron_secret')),
--       body := '{}'::jsonb,
--       timeout_milliseconds := 90000)
--   $$);

-- v5: Şifre sıfırlama ve saha ücreti
-- Kurucunun verdiği geçici şifreyle giren üye yeni şifre belirlemek zorunda.
alter table sportarea."User" add column "mustChangePassword" boolean not null default false;
-- Saha ücreti (₺). Kişi başı pay = ücret / sahada oynayan kişi sayısı.
alter table sportarea."Matches" add column "pitchFee" integer check ("pitchFee" > 0);
alter table sportarea."MatchPlayers" add column paid boolean not null default false;
-- Haftalık maçlara otomatik yazılan varsayılan ücret.
alter table sportarea."Groups" add column "weeklyFee" integer check ("weeklyFee" > 0);

-- Sunucu uykuya geçmesin: Supabase'de 10 dakikada bir sağlık kontrolü (Render ücretsiz plan 15 dk'da uyur).
--   select cron.schedule('sportarea-keepalive', '*/10 * * * *', $$
--     select net.http_get(url := 'https://sportarea.onrender.com/api/health', timeout_milliseconds := 60000)
--   $$);

-- v6: Misafir oyuncu. Misafir, giriş yapamayan bir kullanıcı kaydıdır (User.role = 'GUEST');
-- "invitedBy" onu maça getiren grup üyesidir.
alter table sportarea."MatchPlayers" add column "invitedBy" text references sportarea."User"(id) on delete set null;

-- v7: İptal edilen maç silinmez, status = 'CANCELLED' olur.
--     Maç saatinden sonra bitirilmemiş maç için yöneticiye bir kez hatırlatma.
alter table sportarea."Matches" add column "finishReminderSentAt" timestamptz;

-- v8: Lakap. Uygulamada görünen ad: lakap varsa lakap, yoksa "Ahmet Y."
alter table sportarea."User" add column nickname text check (char_length(nickname) <= 20);

-- v9: Grup yöneticileri. Kurucu üyeleri yönetici yapabilir; yöneticiler maçları ve haftalık ayarı yönetir.
alter table sportarea."GroupMembers" add column "isAdmin" boolean not null default false;

-- v10: Maça özel saha dizilimi. Diziliş kaleci hariç ("2-2-1"); slot 0 = kaleci, sonra defanstan forvete.
alter table sportarea."Matches" add column "teamAFormation" text, add column "teamBFormation" text;
alter table sportarea."MatchPlayers" add column slot integer;

-- v11: Takım kaptanları. Dizilişi o takımın kaptanı ayarlar (kaptan yoksa maçı yöneten).
alter table sportarea."Matches"
  add column "captainA" text references sportarea."User"(id) on delete set null,
  add column "captainB" text references sportarea."User"(id) on delete set null;
