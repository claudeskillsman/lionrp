import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { CatConfig } from '../cat/catConfig';
import { Saves } from '../game/save';

export const SUPABASE_URL = 'https://nallngoaalrfbhwlotcj.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_TT0QKcGASITCZG-B4dpN3w_Hc0s18PF';
const K_TOKEN = 'goldgrass.token.v1';

export interface Account { id: string; username: string | null; guest: boolean; admin: boolean; name: string; settings: Record<string, unknown>; muted: string[]; blocked: string[]; characters: CatConfig[]; banned: boolean; }
export interface ServerInfo { id: string; name: string; private: boolean; code: string | null; max: number; players: number; }
export interface PrideMember { id: string; role: string; name: string; online: boolean; }
export interface Pride { id: string; name: string; color: string; emblem: string; leader: string | null; dens: string[]; members: PrideMember[]; }
export interface Friend { id: string; name: string; username: string | null; status: 'friend' | 'sent' | 'incoming'; server: string | null; serverName: string | null; serverPrivate: boolean; char: string | null; }

let client: SupabaseClient | null = null;
export function sb() {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 30 } } });
  return client;
}

/** Thin wrapper over the security-definer RPCs: every call carries the session token. */
export class Api {
  token: string | null = null;
  account: Account | null = null;
  constructor() { try { this.token = localStorage.getItem(K_TOKEN); } catch { /* */ } }
  private setToken(t: string | null) { this.token = t; try { if (t) localStorage.setItem(K_TOKEN, t); else localStorage.removeItem(K_TOKEN); } catch { /* */ } }
  async call<T>(fn: string, args: Record<string, unknown> = {}, withToken = true): Promise<T> {
    const { data, error } = await sb().rpc(fn, withToken ? { p_token: this.token, ...args } : args);
    if (error) throw new Error(error.message || 'Network error');
    return data as T;
  }
  /** Resume the saved session or start a guest account. */
  async ensure(): Promise<Account> {
    if (this.token) {
      try { this.account = await this.call<Account>('gg_me'); return this.account; } catch { this.setToken(null); }
    }
    const r = await this.call<{ token: string; account: Account }>('gg_guest', {}, false);
    this.setToken(r.token); this.account = r.account;
    return r.account;
  }
  async login(username: string, password: string) {
    const r = await this.call<{ token: string; account: Account }>('gg_login', { p_username: username, p_password: password }, false);
    this.setToken(r.token); this.account = r.account;
    await this.syncCharacters();
    return r.account;
  }
  async register(username: string, password: string) {
    this.account = await this.call<Account>('gg_register', { p_username: username, p_password: password });
    await this.syncCharacters();
    return this.account;
  }
  async logout() { try { await this.call('gg_logout'); } catch { /* */ } this.setToken(null); this.account = null; }
  /** Merge characters both ways: local cats go up, cloud cats come down. */
  async syncCharacters() {
    if (!this.account) return;
    const local = Saves.characters();
    const cloud = this.account.characters ?? [];
    const ids = new Set(cloud.map((c) => c.id));
    for (const c of local) if (!ids.has(c.id)) await this.saveCharacter(c).catch(() => {});
    const merged = [...local];
    for (const c of cloud) { const i = merged.findIndex((x) => x.id === c.id); if (i < 0) merged.push(c); }
    Saves.setCharacters(merged);
    if (this.account.settings && Object.keys(this.account.settings).length) {
      try { const cur = JSON.parse(localStorage.getItem('goldgrass.settings.v1') || '{}'); localStorage.setItem('goldgrass.settings.v1', JSON.stringify({ ...cur, ...this.account.settings })); } catch { /* */ }
    }
  }
  saveCharacter(c: CatConfig) { return this.call<void>('gg_save_character', { p_id: c.id, p_config: c }); }
  deleteCharacter(id: string) { return this.call<void>('gg_delete_character', { p_id: id }); }
  saveSettings(settings: unknown) { return this.call<void>('gg_save_settings', { p_settings: settings, p_muted: this.account?.muted ?? null, p_blocked: this.account?.blocked ?? null }); }
  servers() { return this.call<ServerInfo[]>('gg_server_list'); }
  createServer(name: string, priv: boolean) { return this.call<ServerInfo>('gg_create_server', { p_name: name, p_private: priv }); }
  join(server: string | null, code: string | null, charName: string) { return this.call<{ id: string; name: string; private: boolean; code: string | null; account: string }>('gg_join', { p_server: server, p_code: code, p_char: charName }); }
  joinFriend(friend: string, charName: string) { return this.call<{ id: string; name: string; private: boolean; code: string | null; account: string }>('gg_join_friend', { p_friend: friend, p_char: charName }); }
  heartbeat(server: string, charName: string) { return this.call<{ kicked: boolean; banned: boolean }>('gg_heartbeat', { p_server: server, p_char: charName }); }
  leave() { return this.call<void>('gg_leave'); }
  prideMine() { return this.call<{ pride: Pride | null; invites: { id: string; name: string; color: string; emblem: string }[] }>('gg_pride_mine'); }
  prideCreate(name: string, color: string, emblem: string, charName: string) { return this.call<Pride>('gg_pride_create', { p_name: name, p_color: color, p_emblem: emblem, p_char: charName }); }
  prideUpdate(name: string | null, color: string | null, emblem: string | null) { return this.call<Pride>('gg_pride_update', { p_name: name, p_color: color, p_emblem: emblem }); }
  prideInvite(target: string) { return this.call<void>('gg_pride_invite', { p_target: target }); }
  prideAccept(pride: string, charName: string) { return this.call<Pride>('gg_pride_accept', { p_pride: pride, p_char: charName }); }
  prideDecline(pride: string) { return this.call<void>('gg_pride_decline', { p_pride: pride }); }
  prideKick(target: string) { return this.call<Pride>('gg_pride_kick', { p_target: target }); }
  prideSetRole(target: string, role: string) { return this.call<Pride>('gg_pride_set_role', { p_target: target, p_role: role }); }
  prideLeave() { return this.call<void>('gg_pride_leave'); }
  prideClaimDen(den: string) { return this.call<Pride>('gg_pride_claim_den', { p_den: den }); }
  prideTags(ids: string[]) { return this.call<Record<string, { pride: string; name: string; color: string; emblem: string; role: string }>>('gg_pride_tags', { p_ids: ids }, false); }
  denOwners() { return this.call<Record<string, { name: string; color: string; emblem: string }>>('gg_den_owners', {}, false); }
  friendRequest(username: string | null, id: string | null) { return this.call<void>('gg_friend_request', { p_username: username, p_id: id }); }
  friendRespond(other: string, accept: boolean) { return this.call<void>('gg_friend_respond', { p_other: other, p_accept: accept }); }
  friends() { return this.call<Friend[]>('gg_friend_list'); }
  report(target: string, name: string, server: string | null, reason: string, context: unknown) { return this.call<void>('gg_report', { p_target: target, p_name: name, p_server: server, p_reason: reason, p_context: context }); }
  adminOverview() { return this.call<{ reports: any[]; online: any[]; bans: any[] }>('gg_admin_overview'); }
  adminKick(target: string) { return this.call<void>('gg_admin_kick', { p_target: target }); }
  adminBan(target: string, reason: string, hours: number) { return this.call<void>('gg_admin_ban', { p_target: target, p_reason: reason, p_hours: hours }); }
  adminUnban(target: string) { return this.call<void>('gg_admin_unban', { p_target: target }); }
  adminResolve(report: number, status: string) { return this.call<void>('gg_admin_resolve', { p_report: report, p_status: status }); }
}
export const api = new Api();
