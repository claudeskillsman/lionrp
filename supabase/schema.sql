-- Goldgrass online backend (Supabase / Postgres).
-- Exported from the live project's migrations: goldgrass_core, goldgrass_rpc_auth, goldgrass_rpc_serverlist,
-- goldgrass_rpc_join, goldgrass_rpc_prides, goldgrass_rpc_social. Apply in order on an empty project.
-- After applying, make an admin with: update gg_accounts set is_admin = true where username = '<name>';

-- ===== goldgrass_core =====
create extension if not exists pgcrypto with schema extensions;

create table public.gg_accounts (
  id uuid primary key default gen_random_uuid(),
  username text unique,
  pass_hash text,
  is_guest boolean not null default true,
  is_admin boolean not null default false,
  display_name text not null default 'Guest',
  settings jsonb not null default '{}'::jsonb,
  muted uuid[] not null default '{}',
  blocked uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create table public.gg_tokens (
  token_hash text primary key,
  account_id uuid not null references public.gg_accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.gg_characters (
  id text primary key,
  account_id uuid not null references public.gg_accounts(id) on delete cascade,
  config jsonb not null,
  updated_at timestamptz not null default now()
);
create table public.gg_servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_private boolean not null default false,
  invite_code text unique,
  owner uuid references public.gg_accounts(id) on delete set null,
  max_players int not null default 40,
  created_at timestamptz not null default now()
);
create table public.gg_sessions (
  account_id uuid primary key references public.gg_accounts(id) on delete cascade,
  server_id uuid references public.gg_servers(id) on delete cascade,
  char_name text,
  last_seen timestamptz not null default now()
);
create table public.gg_prides (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#e7b766',
  emblem text not null default '☀',
  leader uuid references public.gg_accounts(id) on delete set null,
  dens text[] not null default '{}',
  created_at timestamptz not null default now()
);
create table public.gg_pride_members (
  pride_id uuid not null references public.gg_prides(id) on delete cascade,
  account_id uuid not null references public.gg_accounts(id) on delete cascade,
  role text not null default 'member',
  char_name text,
  joined_at timestamptz not null default now(),
  primary key (account_id)
);
create table public.gg_pride_invites (
  pride_id uuid not null references public.gg_prides(id) on delete cascade,
  account_id uuid not null references public.gg_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pride_id, account_id)
);
create table public.gg_friends (
  a uuid not null references public.gg_accounts(id) on delete cascade,
  b uuid not null references public.gg_accounts(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (a, b)
);
create table public.gg_reports (
  id bigint generated always as identity primary key,
  reporter uuid references public.gg_accounts(id) on delete set null,
  target uuid references public.gg_accounts(id) on delete cascade,
  target_name text,
  server_id uuid,
  reason text not null,
  context jsonb not null default '[]'::jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create table public.gg_bans (
  account_id uuid primary key references public.gg_accounts(id) on delete cascade,
  reason text,
  until timestamptz,
  created_at timestamptz not null default now()
);
create table public.gg_kicks (
  account_id uuid not null references public.gg_accounts(id) on delete cascade,
  server_id uuid,
  created_at timestamptz not null default now()
);

alter table public.gg_accounts enable row level security;
alter table public.gg_tokens enable row level security;
alter table public.gg_characters enable row level security;
alter table public.gg_servers enable row level security;
alter table public.gg_sessions enable row level security;
alter table public.gg_prides enable row level security;
alter table public.gg_pride_members enable row level security;
alter table public.gg_pride_invites enable row level security;
alter table public.gg_friends enable row level security;
alter table public.gg_reports enable row level security;
alter table public.gg_bans enable row level security;
alter table public.gg_kicks enable row level security;

insert into public.gg_servers (name) values ('Golden Grassland'), ('Watering Hole'), ('Sunstone Kopjes');

-- ===== goldgrass_rpc_auth =====
create or replace function public.gg_uid(p_token text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  select account_id into v from gg_tokens where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex');
  if v is null then raise exception 'not signed in'; end if;
  update gg_accounts set last_seen = now() where id = v;
  return v;
end $$;
revoke all on function public.gg_uid(text) from public, anon, authenticated;

create or replace function public.gg_new_token(p_account uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(32), 'hex');
begin
  insert into gg_tokens(token_hash, account_id) values (encode(digest(t, 'sha256'), 'hex'), p_account);
  return t;
end $$;
revoke all on function public.gg_new_token(uuid) from public, anon, authenticated;

create or replace function public.gg_account_json(p_id uuid) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'username', a.username, 'guest', a.is_guest, 'admin', a.is_admin, 'name', a.display_name,
    'settings', a.settings, 'muted', a.muted, 'blocked', a.blocked,
    'characters', coalesce((select jsonb_agg(c.config order by c.updated_at) from gg_characters c where c.account_id = a.id), '[]'::jsonb),
    'banned', exists(select 1 from gg_bans b where b.account_id = a.id and (b.until is null or b.until > now())))
  from gg_accounts a where a.id = p_id $$;
revoke all on function public.gg_account_json(uuid) from public, anon, authenticated;

create or replace function public.gg_guest() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  insert into gg_accounts(is_guest) values (true) returning id into v;
  return jsonb_build_object('token', gg_new_token(v), 'account', gg_account_json(v));
end $$;

create or replace function public.gg_register(p_token text, p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); u text := lower(trim(p_username));
begin
  if u !~ '^[a-z0-9_]{3,20}$' then raise exception 'Usernames are 3 to 20 letters, numbers or underscores'; end if;
  if length(coalesce(p_password,'')) < 6 then raise exception 'Passwords need at least 6 characters'; end if;
  if exists(select 1 from gg_accounts where username = u) then raise exception 'That username is taken'; end if;
  if not (select is_guest from gg_accounts where id = v) then raise exception 'Already registered'; end if;
  update gg_accounts set username = u, pass_hash = crypt(p_password, gen_salt('bf', 8)), is_guest = false, display_name = u where id = v;
  return gg_account_json(v);
end $$;

create or replace function public.gg_login(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  select id into v from gg_accounts where username = lower(trim(p_username)) and pass_hash = crypt(p_password, pass_hash);
  if v is null then raise exception 'Wrong username or password'; end if;
  return jsonb_build_object('token', gg_new_token(v), 'account', gg_account_json(v));
end $$;

create or replace function public.gg_logout(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from gg_tokens where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex') $$;

create or replace function public.gg_me(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin return gg_account_json(gg_uid(p_token)); end $$;

create or replace function public.gg_save_character(p_token text, p_id text, p_config jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token);
begin
  if length(p_config::text) > 8000 then raise exception 'too large'; end if;
  if (select count(*) from gg_characters where account_id = v) >= 24 and not exists(select 1 from gg_characters where id = p_id and account_id = v) then raise exception 'Character limit reached'; end if;
  insert into gg_characters(id, account_id, config, updated_at) values (p_id, v, p_config, now())
  on conflict (id) do update set config = excluded.config, updated_at = now() where gg_characters.account_id = v;
end $$;

create or replace function public.gg_delete_character(p_token text, p_id text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin delete from gg_characters where id = p_id and account_id = gg_uid(p_token); end $$;

create or replace function public.gg_save_settings(p_token text, p_settings jsonb, p_muted uuid[], p_blocked uuid[]) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(p_settings::text) > 6000 then raise exception 'too large'; end if;
  update gg_accounts set settings = p_settings, muted = coalesce(p_muted, muted), blocked = coalesce(p_blocked, blocked) where id = gg_uid(p_token);
end $$;

-- ===== goldgrass_rpc_serverlist =====
create or replace function public.gg_server_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'private', s.is_private, 'code', case when s.owner = v then s.invite_code end,
      'max', s.max_players, 'players', (select count(*) from gg_sessions x where x.server_id = s.id and x.last_seen > now() - interval '45 seconds'))
    order by s.is_private, s.created_at)
    from gg_servers s where not s.is_private or s.owner = v), '[]'::jsonb);
end $$;

-- ===== goldgrass_rpc_join =====
create or replace function public.gg_create_server(p_token text, p_name text, p_private boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); s gg_servers;
begin
  if (select count(*) from gg_servers where owner = v) >= 5 then raise exception 'You already have 5 private servers'; end if;
  insert into gg_servers(name, is_private, invite_code, owner)
  values (left(coalesce(nullif(trim(p_name),''), 'Private den'), 32), coalesce(p_private, true), upper(encode(gen_random_bytes(4), 'hex')), v)
  returning * into s;
  return jsonb_build_object('id', s.id, 'name', s.name, 'private', s.is_private, 'code', s.invite_code);
end $$;

alter table public.gg_kicks add column if not exists consumed boolean not null default false;

create or replace function public.gg_join(p_token text, p_server uuid, p_code text, p_char text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); s gg_servers; n int;
begin
  if exists(select 1 from gg_bans b where b.account_id = v and (b.until is null or b.until > now())) then raise exception 'This account is banned'; end if;
  if p_code is not null and p_code <> '' then select * into s from gg_servers where invite_code = upper(trim(p_code));
  else select * into s from gg_servers where id = p_server; end if;
  if s.id is null then raise exception 'Server not found'; end if;
  select count(*) into n from gg_sessions where server_id = s.id and last_seen > now() - interval '45 seconds' and account_id <> v;
  if n >= s.max_players then raise exception 'That server is full'; end if;
  update gg_kicks set consumed = true where account_id = v;
  insert into gg_sessions(account_id, server_id, char_name, last_seen) values (v, s.id, left(p_char, 24), now())
  on conflict (account_id) do update set server_id = excluded.server_id, char_name = excluded.char_name, last_seen = now();
  return jsonb_build_object('id', s.id, 'name', s.name, 'private', s.is_private, 'code', case when s.is_private then s.invite_code end, 'account', v);
end $$;

create or replace function public.gg_heartbeat(p_token text, p_server uuid, p_char text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); k boolean; b boolean;
begin
  update gg_sessions set last_seen = now(), char_name = left(p_char, 24), server_id = p_server where account_id = v;
  select exists(select 1 from gg_kicks where account_id = v and not consumed) into k;
  select exists(select 1 from gg_bans x where x.account_id = v and (x.until is null or x.until > now())) into b;
  if k then update gg_kicks set consumed = true where account_id = v; end if;
  return jsonb_build_object('kicked', k, 'banned', b);
end $$;

create or replace function public.gg_leave(p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin update gg_sessions set server_id = null, last_seen = 'epoch' where account_id = gg_uid(p_token); end $$;

-- ===== goldgrass_rpc_prides =====
alter table public.gg_pride_members alter column pride_id drop not null;
alter table public.gg_pride_invites add column if not exists used boolean not null default false;

create or replace function public.gg_pride_json(p_pride uuid) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color, 'emblem', p.emblem, 'leader', p.leader, 'dens', p.dens,
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.account_id, 'role', m.role, 'name', coalesce(m.char_name, a.display_name),
        'online', exists(select 1 from gg_sessions s where s.account_id = m.account_id and s.last_seen > now() - interval '45 seconds')) order by m.joined_at)
      from gg_pride_members m join gg_accounts a on a.id = m.account_id where m.pride_id = p.id), '[]'::jsonb))
  from gg_prides p where p.id = p_pride $$;
revoke all on function public.gg_pride_json(uuid) from public, anon, authenticated;

create or replace function public.gg_pride_mine(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); pid uuid;
begin
  select pride_id into pid from gg_pride_members where account_id = v;
  return jsonb_build_object('pride', case when pid is null then null else gg_pride_json(pid) end,
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color, 'emblem', p.emblem))
      from gg_pride_invites i join gg_prides p on p.id = i.pride_id where i.account_id = v and not i.used), '[]'::jsonb));
end $$;

create or replace function public.gg_pride_create(p_token text, p_name text, p_color text, p_emblem text, p_char text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); pid uuid;
begin
  if exists(select 1 from gg_pride_members where account_id = v and pride_id is not null) then raise exception 'Leave your current pride first'; end if;
  insert into gg_prides(name, color, emblem, leader) values (left(coalesce(nullif(trim(p_name),''),'New Pride'), 28), left(p_color, 9), left(p_emblem, 4), v) returning id into pid;
  insert into gg_pride_members(pride_id, account_id, role, char_name) values (pid, v, 'leader', left(p_char, 24))
  on conflict (account_id) do update set pride_id = pid, role = 'leader', char_name = excluded.char_name, joined_at = now();
  return gg_pride_json(pid);
end $$;

create or replace function public.gg_pride_update(p_token text, p_name text, p_color text, p_emblem text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); pid uuid;
begin
  select pride_id into pid from gg_pride_members where account_id = v and role = 'leader';
  if pid is null then raise exception 'Only the pride leader can do that'; end if;
  update gg_prides set name = left(coalesce(nullif(trim(p_name),''), name), 28), color = left(coalesce(p_color, color), 9), emblem = left(coalesce(p_emblem, emblem), 4) where id = pid;
  return gg_pride_json(pid);
end $$;

create or replace function public.gg_pride_invite(p_token text, p_target uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); pid uuid;
begin
  select pride_id into pid from gg_pride_members where account_id = v and role in ('leader','hunter','healer');
  if pid is null then raise exception 'Only pride leaders can invite'; end if;
  insert into gg_pride_invites(pride_id, account_id) values (pid, p_target) on conflict (pride_id, account_id) do update set used = false, created_at = now();
end $$;

create or replace function public.gg_pride_accept(p_token text, p_pride uuid, p_char text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token);
begin
  if not exists(select 1 from gg_pride_invites where pride_id = p_pride and account_id = v and not used) then raise exception 'That invite has expired'; end if;
  perform gg_pride_leave(p_token);
  update gg_pride_invites set used = true where account_id = v and pride_id = p_pride;
  insert into gg_pride_members(pride_id, account_id, role, char_name) values (p_pride, v, 'member', left(p_char, 24))
  on conflict (account_id) do update set pride_id = p_pride, role = 'member', char_name = excluded.char_name, joined_at = now();
  return gg_pride_json(p_pride);
end $$;

create or replace function public.gg_pride_decline(p_token text, p_pride uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin update gg_pride_invites set used = true where account_id = gg_uid(p_token) and pride_id = p_pride; end $$;

create or replace function public.gg_pride_kick(p_token text, p_target uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); pid uuid;
begin
  select pride_id into pid from gg_pride_members where account_id = v and role = 'leader';
  if pid is null then raise exception 'Only the pride leader can do that'; end if;
  if p_target = v then raise exception 'Leaders cannot remove themselves'; end if;
  update gg_pride_members set pride_id = null where pride_id = pid and account_id = p_target;
  return gg_pride_json(pid);
end $$;

create or replace function public.gg_pride_set_role(p_token text, p_target uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); pid uuid;
begin
  select pride_id into pid from gg_pride_members where account_id = v and role = 'leader';
  if pid is null then raise exception 'Only the pride leader can do that'; end if;
  if p_role not in ('hunter','healer','member','cub') then raise exception 'Unknown role'; end if;
  update gg_pride_members set role = p_role where pride_id = pid and account_id = p_target and account_id <> v;
  return gg_pride_json(pid);
end $$;

create or replace function public.gg_pride_leave(p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); pid uuid; was_leader boolean; nxt uuid;
begin
  select pride_id, role = 'leader' into pid, was_leader from gg_pride_members where account_id = v;
  if pid is null then return; end if;
  update gg_pride_members set pride_id = null, role = 'member' where account_id = v;
  if was_leader then
    select account_id into nxt from gg_pride_members where pride_id = pid order by joined_at limit 1;
    if nxt is not null then
      update gg_prides set leader = nxt where id = pid;
      update gg_pride_members set role = 'leader' where account_id = nxt;
    else
      update gg_prides set leader = null, dens = '{}' where id = pid;
    end if;
  end if;
end $$;

create or replace function public.gg_pride_claim_den(p_token text, p_den text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); pid uuid;
begin
  select pride_id into pid from gg_pride_members where account_id = v;
  if pid is null then raise exception 'Join or found a pride first'; end if;
  if p_den !~ '^[a-z]{3,12}$' then raise exception 'Unknown den'; end if;
  update gg_prides set dens = array_remove(dens, p_den) where id <> pid and p_den = any(dens);
  update gg_prides set dens = array_append(array_remove(dens, p_den), p_den) where id = pid;
  return gg_pride_json(pid);
end $$;

create or replace function public.gg_pride_tags(p_ids uuid[]) returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(m.account_id, jsonb_build_object('pride', p.id, 'name', p.name, 'color', p.color, 'emblem', p.emblem, 'role', m.role)), '{}'::jsonb)
  from gg_pride_members m join gg_prides p on p.id = m.pride_id where m.account_id = any(p_ids) $$;

create or replace function public.gg_den_owners() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(d, jsonb_build_object('name', p.name, 'color', p.color, 'emblem', p.emblem)), '{}'::jsonb)
  from gg_prides p, unnest(p.dens) d where p.leader is not null $$;

-- ===== goldgrass_rpc_social =====
create or replace function public.gg_friend_request(p_token text, p_username text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); t uuid;
begin
  if p_id is not null then t := p_id; else select id into t from gg_accounts where username = lower(trim(p_username)); end if;
  if t is null then raise exception 'No player with that username'; end if;
  if t = v then raise exception 'That is you'; end if;
  if exists(select 1 from gg_friends where a = t and b = v) then
    update gg_friends set status = 'accepted' where a = t and b = v;
  else
    insert into gg_friends(a, b) values (v, t) on conflict (a, b) do update set status = case when gg_friends.status = 'accepted' then 'accepted' else 'pending' end;
  end if;
end $$;

create or replace function public.gg_friend_respond(p_token text, p_other uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token);
begin
  update gg_friends set status = case when p_accept then 'accepted' else 'removed' end where (a = p_other and b = v) or (a = v and b = p_other and not p_accept);
end $$;

create or replace function public.gg_friend_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.display_name, 'username', o.username,
      'status', case when f.status = 'accepted' then 'friend' when f.a = v then 'sent' else 'incoming' end,
      'server', case when f.status = 'accepted' and s.last_seen > now() - interval '45 seconds' then s.server_id end,
      'serverName', case when f.status = 'accepted' and s.last_seen > now() - interval '45 seconds' then sv.name end,
      'serverPrivate', coalesce(sv.is_private, false),
      'char', s.char_name))
    from gg_friends f join gg_accounts o on o.id = case when f.a = v then f.b else f.a end
    left join gg_sessions s on s.account_id = o.id left join gg_servers sv on sv.id = s.server_id
    where (f.a = v or f.b = v) and f.status <> 'removed'), '[]'::jsonb);
end $$;

-- joining a friend's server, including a private one, works only for accepted friends
create or replace function public.gg_join_friend(p_token text, p_friend uuid, p_char text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token); sid uuid;
begin
  if not exists(select 1 from gg_friends where status = 'accepted' and ((a = v and b = p_friend) or (a = p_friend and b = v))) then raise exception 'Not friends'; end if;
  select server_id into sid from gg_sessions where account_id = p_friend and last_seen > now() - interval '45 seconds';
  if sid is null then raise exception 'Your friend is offline'; end if;
  return gg_join(p_token, sid, null, p_char);
end $$;

create or replace function public.gg_report(p_token text, p_target uuid, p_name text, p_server uuid, p_reason text, p_context jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token);
begin
  if (select count(*) from gg_reports where reporter = v and created_at > now() - interval '10 minutes') >= 10 then raise exception 'Too many reports, try again later'; end if;
  insert into gg_reports(reporter, target, target_name, server_id, reason, context) values (v, p_target, left(p_name, 40), p_server, left(p_reason, 500), coalesce(p_context, '[]'::jsonb));
end $$;

create or replace function public.gg_require_admin(p_token text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := gg_uid(p_token);
begin
  if not (select is_admin from gg_accounts where id = v) then raise exception 'Admins only'; end if;
  return v;
end $$;
revoke all on function public.gg_require_admin(text) from public, anon, authenticated;

create or replace function public.gg_admin_overview(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform gg_require_admin(p_token);
  return jsonb_build_object(
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'target', r.target, 'targetName', r.target_name, 'reporter', ra.display_name, 'reason', r.reason, 'context', r.context, 'status', r.status, 'at', r.created_at, 'server', sv.name) order by r.created_at desc)
      from (select * from gg_reports order by created_at desc limit 200) r left join gg_accounts ra on ra.id = r.reporter left join gg_servers sv on sv.id = r.server_id), '[]'::jsonb),
    'online', coalesce((select jsonb_agg(jsonb_build_object('id', s.account_id, 'char', s.char_name, 'name', a.display_name, 'server', sv.name, 'serverId', s.server_id))
      from gg_sessions s join gg_accounts a on a.id = s.account_id left join gg_servers sv on sv.id = s.server_id where s.last_seen > now() - interval '45 seconds'), '[]'::jsonb),
    'bans', coalesce((select jsonb_agg(jsonb_build_object('id', b.account_id, 'name', a.display_name, 'reason', b.reason, 'until', b.until))
      from gg_bans b join gg_accounts a on a.id = b.account_id where b.until is null or b.until > now()), '[]'::jsonb));
end $$;

create or replace function public.gg_admin_kick(p_token text, p_target uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin perform gg_require_admin(p_token); insert into gg_kicks(account_id) values (p_target); end $$;

create or replace function public.gg_admin_ban(p_token text, p_target uuid, p_reason text, p_hours int) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform gg_require_admin(p_token);
  insert into gg_bans(account_id, reason, until) values (p_target, left(p_reason, 200), case when p_hours is null or p_hours <= 0 then null else now() + make_interval(hours => p_hours) end)
  on conflict (account_id) do update set reason = excluded.reason, until = excluded.until;
  insert into gg_kicks(account_id) values (p_target);
end $$;

create or replace function public.gg_admin_unban(p_token text, p_target uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin perform gg_require_admin(p_token); update gg_bans set until = now() where account_id = p_target; end $$;

create or replace function public.gg_admin_resolve(p_token text, p_report bigint, p_status text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin perform gg_require_admin(p_token); update gg_reports set status = left(p_status, 20) where id = p_report; end $$;
