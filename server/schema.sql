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
-- Sohbet ve müsaitlik özellikleri kaldırıldı. Canlı veritabanında boş "MatchMessages", "GroupMessages"
-- ve "UserAvailability" tabloları hâlâ duruyor; kod artık bunları kullanmıyor, istenirse silinebilir:
--   drop table sportarea."MatchMessages", sportarea."GroupMessages", sportarea."UserAvailability";
