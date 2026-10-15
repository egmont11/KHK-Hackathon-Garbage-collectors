import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { writeFile, readFile, lstat } from "node:fs/promises";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { config } from "./config.js";

const rawScrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
let passwordJobs = 0;
async function scrypt(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  if (passwordJobs >= 16) throw Object.assign(new Error("Password verification is busy. Try later."), { statusCode: 429, code: "PASSWORD_WORK_BUSY" });
  passwordJobs++;
  try { return await rawScrypt(password, salt, keylen); } finally { passwordJobs--; }
}

export type Admin = { id: string; username: string; passwordHash: string; mustChangePassword: boolean; createdAt: number };
type Session = { adminId: string; expiresAt: number; passwordHash: string };

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
  private readonly dummyHash = hashPassword(randomUUID());

  constructor(private readonly pool?: Pool) {}

  /** Bootstrap secrets go to a private local file or an explicit environment setting, never logs. */
  async initialize(log: (message: string) => void): Promise<void> {
    if (this.pool) {
      const rows = await this.pool.query("SELECT id, username, password_hash, must_change_password, created_at FROM admins");
      for (const row of rows.rows) this.admins.set(row.id, {
        id: row.id, username: row.username, passwordHash: row.password_hash,
        mustChangePassword: row.must_change_password, createdAt: new Date(row.created_at).getTime(),
      });
    }
    const existing = await this.byUsername(config.adminUsername);
    if (existing && !config.adminReset) {
      if (config.production && await verifyPassword("admin", existing.passwordHash)) {
        throw new Error("Insecure legacy admin/admin account: set ADMIN_RESET=1 and a strong ADMIN_PASSWORD once");
      }
      return;
    }
    let password = config.adminInitialPassword ?? generatePassword();
    const problem = passwordProblem(password);
    if (problem) throw new Error(`Invalid initial admin password: ${problem}`);
    // Never put credentials in stdout / centralized logs. wx refuses an existing file.
    if (!config.adminInitialPassword) {
      if (config.production) throw new Error("ADMIN_PASSWORD is required in production");
      try { await writeFile(config.adminPasswordFile, password + "\n", { mode: 0o600, flag: "wx" }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const stat = await lstat(config.adminPasswordFile);
        if (!stat.isFile() || (stat.mode & 0o077)) throw new Error("Admin credential file must be a regular file with mode 0600");
        password = (await readFile(config.adminPasswordFile, "utf8")).trim();
        const storedProblem = passwordProblem(password);
        if (storedProblem) throw new Error(storedProblem);
      }
    }
    if (existing) {
      await this.setPassword(existing, password, config.adminMustChange);
    } else {
      await this.create(config.adminUsername, password, config.adminMustChange);
    }
    const banner = "=".repeat(64);
    log([
      banner,
      `Admin účet ${existing ? "resetován" : "vytvořen"}: uživatel "${config.adminUsername}"`,
      config.adminInitialPassword ? "Heslo: z proměnné ADMIN_PASSWORD" : `Počáteční heslo: soubor ${config.adminPasswordFile} (oprávnění 0600)`,
      config.adminMustChange ? "Po prvním přihlášení je nutné heslo změnit." : "",
      `Dashboard: http://localhost:${config.port}/dashboard`,
      banner,
    ].filter(Boolean).join("\n"));
  }

  private fromRow(row: any): Admin {
    return { id: row.id, username: row.username, passwordHash: row.password_hash,
      mustChangePassword: row.must_change_password, createdAt: new Date(row.created_at).getTime() };
  }

  async list(): Promise<Admin[]> {
    if (this.pool) {
      const result = await this.pool.query("SELECT * FROM admins ORDER BY created_at");
      return result.rows.map((row) => this.fromRow(row));
    }
    return [...this.admins.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  async get(id: string): Promise<Admin | undefined> {
    if (!this.pool) return this.admins.get(id);
    const result = await this.pool.query("SELECT * FROM admins WHERE id = $1", [id]);
    return result.rows[0] ? this.fromRow(result.rows[0]) : undefined;
  }

  async byUsername(username: string): Promise<Admin | undefined> {
    const wanted = username.trim().toLowerCase();
    if (this.pool) {
      const result = await this.pool.query("SELECT * FROM admins WHERE lower(username) = $1", [wanted]);
      return result.rows[0] ? this.fromRow(result.rows[0]) : undefined;
    }
    return [...this.admins.values()].find((admin) => admin.username.toLowerCase() === wanted);
  }

  async create(username: string, password: string, mustChange = true): Promise<Admin> {
    const problem = passwordProblem(password);
    if (problem) throw new Error(problem);
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

  async login(username: string, password: string, _client?: string): Promise<{ admin: Admin; token: string; expiresAt: number } | null> {
    const admin = await this.byUsername(username);
    const verifiedHash = admin?.passwordHash ?? await this.dummyHash;
    const ok = await verifyPassword(password, verifiedHash);
    if (!admin || !ok) return null;
    // Verification may have crossed a password change or account removal.
    const current = await this.get(admin.id);
    if (!current || current.passwordHash !== verifiedHash) return null;
    return { admin: current, ...this.newSession(current) };
  }

  newSession(admin: Admin) {
    for (const [key, row] of this.sessions) if (row.expiresAt <= Date.now()) this.sessions.delete(key);
    const existing = [...this.sessions].filter(([, row]) => row.adminId === admin.id);
    // Bound memory even for a valid account repeatedly logging in.
    if (existing.length >= 10) this.sessions.delete(existing[0][0]);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + config.adminSessionHours * 3600_000;
    this.sessions.set(token, { adminId: admin.id, expiresAt, passwordHash: admin.passwordHash });
    return { token, expiresAt };
  }

  async adminForToken(token?: string): Promise<Admin | undefined> {
    if (!token) return undefined;
    const session = this.sessions.get(token);
    if (!session) return undefined;
    const admin = await this.get(session.adminId);
    if (session.expiresAt <= Date.now() || !admin || admin.passwordHash !== session.passwordHash) {
      this.sessions.delete(token);
      return undefined;
    }
    return admin;
  }

  logout(token: string) {
    this.sessions.delete(token);
  }

  /** Drops every session of an admin except the one given (after a password change). */
  revokeOtherSessions(adminId: string, keepToken: string, passwordHash: string) {
    const kept = this.sessions.get(keepToken);
    if (kept?.adminId === adminId) kept.passwordHash = passwordHash;
    for (const [token, session] of this.sessions) if (session.adminId === adminId && token !== keepToken) this.sessions.delete(token);
  }
}
