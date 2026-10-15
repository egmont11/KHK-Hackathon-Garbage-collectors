import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { config } from "./config.js";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export type Admin = { id: string; username: string; passwordHash: string; mustChangePassword: boolean; createdAt: number };
type Session = { adminId: string; expiresAt: number };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generatePassword(): string {
  // 16 chars from an unambiguous alphabet, readable when printed to the console.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  for (;;) {
    const password = [...randomBytes(16)].map((byte) => alphabet[byte % alphabet.length]).join("");
    if (/[a-zA-Z]/.test(password) && /[0-9]/.test(password)) return password;
  }
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < config.adminMinPasswordLength) return `Heslo musí mít aspoň ${config.adminMinPasswordLength} znaků.`;
  if (password.length > 200) return "Heslo je příliš dlouhé.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "Heslo musí obsahovat písmena i číslice.";
  return null;
}

/** Region administrators. Sessions are in memory: a restart logs everyone out. */
export class AdminStore {
  private readonly admins = new Map<string, Admin>();
  private readonly sessions = new Map<string, Session>();
  private readonly failures = new Map<string, { count: number; until: number }>();
  private readonly dummyHash = hashPassword(randomUUID());

  constructor(private readonly pool?: Pool) {}

  /** Loads admins and makes sure the built-in admin exists. Prints its password when it creates/resets it. */
  async initialize(log: (message: string) => void): Promise<void> {
    if (this.pool) {
      const rows = await this.pool.query("SELECT id, username, password_hash, must_change_password, created_at FROM admins");
      for (const row of rows.rows) this.admins.set(row.id, {
        id: row.id, username: row.username, passwordHash: row.password_hash,
        mustChangePassword: row.must_change_password, createdAt: new Date(row.created_at).getTime(),
      });
    }
    const existing = this.byUsername(config.adminUsername);
    if (existing && !config.adminReset) return;
    const password = config.adminInitialPassword ?? generatePassword();
    if (existing) {
      await this.setPassword(existing, password, config.adminMustChange);
    } else {
      await this.create(config.adminUsername, password, config.adminMustChange);
    }
    const banner = "=".repeat(64);
    log([
      banner,
      `Admin účet ${existing ? "resetován" : "vytvořen"}: uživatel "${config.adminUsername}"`,
      process.env.ADMIN_PASSWORD ? "Heslo: z proměnné ADMIN_PASSWORD" : `Heslo: ${password}${config.adminInitialPassword ? " (demo režim)" : ""}`,
      config.adminMustChange ? "Po prvním přihlášení je nutné heslo změnit." : "",
      `Dashboard: http://localhost:${config.port}/dashboard`,
      banner,
    ].filter(Boolean).join("\n"));
  }

  list(): Admin[] {
    return [...this.admins.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string) {
    return this.admins.get(id);
  }

  byUsername(username: string): Admin | undefined {
    const wanted = username.trim().toLowerCase();
    return [...this.admins.values()].find((admin) => admin.username.toLowerCase() === wanted);
  }

  async create(username: string, password: string, mustChange = true): Promise<Admin> {
    const admin: Admin = { id: randomUUID(), username: username.trim(), passwordHash: await hashPassword(password), mustChangePassword: mustChange, createdAt: Date.now() };
    if (this.pool) await this.pool.query(
      "INSERT INTO admins (id, username, password_hash, must_change_password, created_at) VALUES ($1, $2, $3, $4, $5)",
      [admin.id, admin.username, admin.passwordHash, admin.mustChangePassword, new Date(admin.createdAt).toISOString()],
    );
    this.admins.set(admin.id, admin);
    return admin;
  }

  async remove(id: string): Promise<void> {
    if (this.pool) await this.pool.query("DELETE FROM admins WHERE id = $1", [id]);
    this.admins.delete(id);
    for (const [token, session] of this.sessions) if (session.adminId === id) this.sessions.delete(token);
  }

  async setPassword(admin: Admin, password: string, mustChange: boolean): Promise<void> {
    const hash = await hashPassword(password);
    if (this.pool) await this.pool.query(
      "UPDATE admins SET password_hash = $2, must_change_password = $3, password_changed_at = now() WHERE id = $1",
      [admin.id, hash, mustChange],
    );
    admin.passwordHash = hash;
    admin.mustChangePassword = mustChange;
  }

  /** Simple brute-force brake: 5 failed attempts per client → locked for a minute. */
  lockedFor(client: string): number {
    const entry = this.failures.get(client);
    return entry && entry.until > Date.now() ? Math.ceil((entry.until - Date.now()) / 1000) : 0;
  }

  async login(username: string, password: string, client: string): Promise<{ admin: Admin; token: string; expiresAt: number } | null> {
    const admin = this.byUsername(username);
    // Always run scrypt so unknown usernames take as long as wrong passwords.
    const ok = admin ? await verifyPassword(password, admin.passwordHash) : (await verifyPassword(password, await this.dummyHash), false);
    if (!admin || !ok) {
      const entry = this.failures.get(client);
      const count = (entry && entry.until > Date.now() - 60_000 ? entry.count : 0) + 1;
      this.failures.set(client, { count, until: count >= 5 ? Date.now() + 60_000 : Date.now() });
      return null;
    }
    this.failures.delete(client);
    return { admin, ...this.newSession(admin) };
  }

  newSession(admin: Admin) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + config.adminSessionHours * 3600_000;
    this.sessions.set(token, { adminId: admin.id, expiresAt });
    return { token, expiresAt };
  }

  adminForToken(token?: string): Admin | undefined {
    if (!token) return undefined;
    const session = this.sessions.get(token);
    if (!session) return undefined;
    if (session.expiresAt < Date.now()) { this.sessions.delete(token); return undefined; }
    return this.admins.get(session.adminId);
  }

  logout(token: string) {
    this.sessions.delete(token);
  }

  /** Drops every session of an admin except the one given (after a password change). */
  revokeOtherSessions(adminId: string, keepToken: string) {
    for (const [token, session] of this.sessions) if (session.adminId === adminId && token !== keepToken) this.sessions.delete(token);
  }
}
