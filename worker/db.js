// Database schema, first-run setup and the clearance rule.
// The Worker creates its own tables on first use, so no migration step is
// needed in the dashboard. Statements are idempotent.

import { ORGS, RANKS, OLD_LONG_NAMES, OLD_COMPARTMENTS, OLD_MIN_TIERS, DEPT_RANKS } from "./seed.js";
import { getMembers } from "./auth.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  division TEXT NOT NULL DEFAULT 'public',
  tier_public INTEGER NOT NULL DEFAULT 1,
  tier_secret INTEGER NOT NULL DEFAULT 0,
  tier_government INTEGER NOT NULL DEFAULT 0,
  tier4 INTEGER NOT NULL DEFAULT 0,
  pass_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  long_name TEXT,
  compartment TEXT NOT NULL DEFAULT 'public',
  min_tier INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  access TEXT NOT NULL DEFAULT 'tiered'
);
CREATE TABLE IF NOT EXISTS ranks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  band TEXT NOT NULL,
  tier INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(org_id, name)
);
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  rank_id INTEGER REFERENCES ranks(id),
  rank_text TEXT,
  title TEXT,
  name TEXT NOT NULL,
  party_member INTEGER,
  status TEXT NOT NULL DEFAULT 'watched',
  tier INTEGER NOT NULL DEFAULT 1,
  info TEXT,
  portrait TEXT,
  reports_to INTEGER REFERENCES people(id) ON DELETE SET NULL,
  x REAL,
  y REAL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS people_org ON people(org_id);
CREATE INDEX IF NOT EXISTS people_sup ON people(reports_to);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id),
  tier INTEGER NOT NULL DEFAULT 1,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS reports_person ON reports(person_id);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body TEXT NOT NULL,
  subject TEXT,
  when_text TEXT,
  where_text TEXT,
  witnesses TEXT,
  reporter_name TEXT,
  reporter_contact TEXT,
  ip_hash TEXT,
  restricted INTEGER NOT NULL DEFAULT 0,
  restricted_by INTEGER REFERENCES users(id),
  restricted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS notes_created ON notes(created_at);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  author_id INTEGER,
  author_name TEXT NOT NULL,
  author_rank TEXT,
  body TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_room ON messages(room, id);
CREATE TABLE IF NOT EXISTS room_reads (
  user_id INTEGER NOT NULL,
  room TEXT NOT NULL,
  last_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, room)
);
`;

let ready = null;
let sessionSecret = null;

// Creates the tables on first use and resolves to the session-signing key.
export function ensureSchema(env) {
  if (!ready) ready = setup(env).catch((e) => { ready = null; throw e; });
  return ready;
}

// The key sessions are signed with: SESSION_SECRET if set, otherwise one the
// Worker generated and stored in the database on first run.
export function getSessionSecret(env) {
  return env.SESSION_SECRET || sessionSecret;
}

async function setup(env) {
  const db = env.DB;
  await db.exec(SCHEMA.replace(/\n\s*/g, " ").replace(/;\s*/g, ";\n"));

  if (!env.SESSION_SECRET) {
    const row = await db.prepare("SELECT v FROM meta WHERE k = 'session_secret'").first();
    if (row) sessionSecret = row.v;
    else {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      sessionSecret = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
      await db.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('session_secret', ?)").bind(sessionSecret).run();
      const again = await db.prepare("SELECT v FROM meta WHERE k = 'session_secret'").first();
      sessionSecret = again.v;
    }
  }

  // Columns added after the first release.
  const cols = (await db.prepare("PRAGMA table_info(organizations)").all()).results.map((c) => c.name);
  if (!cols.includes("access")) await db.exec("ALTER TABLE organizations ADD COLUMN access TEXT NOT NULL DEFAULT 'tiered'");
  const ucols = (await db.prepare("PRAGMA table_info(users)").all()).results.map((c) => c.name);
  if (!ucols.includes("rank")) await db.exec("ALTER TABLE users ADD COLUMN rank TEXT");
  if (!ucols.includes("must_change")) await db.exec("ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0");
  if (!ucols.includes("person_id")) await db.exec("ALTER TABLE users ADD COLUMN person_id INTEGER");
  const pcols = (await db.prepare("PRAGMA table_info(people)").all()).results.map((c) => c.name);
  if (!pcols.includes("division")) await db.exec("ALTER TABLE people ADD COLUMN division TEXT");

  const orgCount = (await db.prepare("SELECT COUNT(*) AS n FROM organizations").first()).n;
  if (orgCount === 0) {
    await db.batch(ORGS.map((o) =>
      db.prepare("INSERT INTO organizations (slug, name, long_name, compartment, min_tier, sort, access) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(o.slug, o.name, o.long, o.compartment, o.min_tier, o.sort, o.access || "tiered")
    ));
  }
  // Corrected organization names and handbook compartments, applied only
  // where the old seed value is still in place.
  await db.batch([
    ...Object.entries(OLD_LONG_NAMES).map(([slug, old]) =>
      db.prepare("UPDATE organizations SET long_name = ? WHERE slug = ? AND long_name = ?")
        .bind(ORGS.find((o) => o.slug === slug).long, slug, old)),
    ...Object.entries(OLD_COMPARTMENTS).map(([slug, old]) =>
      db.prepare("UPDATE organizations SET compartment = ? WHERE slug = ? AND compartment = ?")
        .bind(ORGS.find((o) => o.slug === slug).compartment, slug, old)),
    ...Object.entries(OLD_MIN_TIERS).map(([slug, old]) =>
      db.prepare("UPDATE organizations SET min_tier = ?, access = ? WHERE slug = ? AND min_tier = ?")
        .bind(ORGS.find((o) => o.slug === slug).min_tier, ORGS.find((o) => o.slug === slug).access || "tiered", slug, old)),
  ]);

  // Ranks: seed on first run; on later runs add any rank the table lacks and
  // bring every rank's band, tier and order in line with the seed. Ranks an
  // admin has not touched are unaffected in meaning; only new ones appear.
  const orgs = await db.prepare("SELECT id, slug FROM organizations").all();
  const byslug = Object.fromEntries(orgs.results.map((o) => [o.slug, o.id]));
  const rows = RANKS.filter((r) => byslug[r.org]);

  // The Party tab's ranks are the Department's own; retire any other rank
  // still filed there (people keep their file, with the rank cleared).
  if (byslug.party) {
    const marks = DEPT_RANKS.map(() => "?").join(",");
    await db.prepare(`UPDATE people SET rank_id = NULL WHERE rank_id IN (SELECT id FROM ranks WHERE org_id = ? AND name NOT IN (${marks}))`)
      .bind(byslug.party, ...DEPT_RANKS).run();
    await db.prepare(`DELETE FROM ranks WHERE org_id = ? AND name NOT IN (${marks})`).bind(byslug.party, ...DEPT_RANKS).run();
  }

  const rankCount = (await db.prepare("SELECT COUNT(*) AS n FROM ranks").first()).n;
  if (rankCount !== rows.length) {
    for (let i = 0; i < rows.length; i += 50) {
      await db.batch(rows.slice(i, i + 50).map((r) =>
        db.prepare("INSERT OR IGNORE INTO ranks (org_id, name, band, tier, sort) VALUES (?, ?, ?, ?, ?)")
          .bind(byslug[r.org], r.name, r.band, r.tier, r.sort)
      ));
    }
    for (let i = 0; i < rows.length; i += 50) {
      await db.batch(rows.slice(i, i + 50).map((r) =>
        db.prepare("UPDATE ranks SET band = ?, tier = ?, sort = ? WHERE org_id = ? AND name = ?")
          .bind(r.band, r.tier, r.sort, byslug[r.org], r.name)
      ));
    }
  }

  // First run: the roll in the MEMBERS secret becomes the first admins.
  const userCount = (await db.prepare("SELECT COUNT(*) AS n FROM users").first()).n;
  if (userCount === 0) {
    const members = getMembers(env) || {};
    const stmts = Object.entries(members).map(([username, m]) =>
      db.prepare("INSERT OR IGNORE INTO users (username, name, role, division, tier_public, tier_secret, tier_government, tier4, pass_hash) VALUES (?, ?, 'admin', 'government', 3, 3, 3, 1, ?)")
        .bind(username, m.name || username, m.hash)
    );
    if (stmts.length) await db.batch(stmts);
  }
}

/* ---------- users ---------- */

export const USER_COLS = "id, username, name, role, rank, division, tier_public, tier_secret, tier_government, tier4, active, must_change, person_id, created_at";

export async function loadUser(env, session) {
  if (!session || !session.id) return null;
  const u = await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ? AND active = 1`).bind(session.id).first();
  return u || null;
}

export function isAdmin(user) {
  return !!user && user.role === "admin";
}

/* ---------- clearance ---------- */

export function userTier(user, compartment) {
  if (!user) return 0;
  if (user.tier4) return 4;
  return Number(user["tier_" + compartment] || 0);
}

// The highest tier a user holds in any compartment (4 for Tier 4).
export function maxTier(user) {
  if (!user) return 0;
  if (user.tier4) return 4;
  return Math.max(Number(user.tier_public || 0), Number(user.tier_secret || 0), Number(user.tier_government || 0));
}

export function divisionsOf(x) {
  return String((x && x.division) || "").split(",").map((d) => d.trim()).filter(Boolean);
}

// Is the user placed in Abt. II Schatten? Schatten sees every tree.
export function inSchatten(user) {
  return divisionsOf(user).includes("secret");
}

// On an open tab (the Party, the Department's own personnel) a record is
// read by division, not tier: a Curator sees everyone filed to a division
// they sit in, whatever the rank. Tier 4 sees all. A record filed to no
// division is open to every member.
export function sameDivision(user, person) {
  if (!user) return false;
  if (user.tier4) return true;
  const mine = divisionsOf(user);
  const theirs = divisionsOf(person);
  if (!theirs.length) return true;
  return theirs.some((d) => mine.includes(d));
}

// How a user sees an organization's tab:
//   "full"  — every file, no tiering (the organization is open to all)
//   "tiered"— the normal rule: files at or below the user's tier in the compartment
//   "bare"  — the tree only, every person a plain CONFIDENTIAL card (Schatten's broad scope)
//   null    — not shown
export function orgAccess(user, org) {
  if (!user) return null;
  if (org.access === "open") return "full";
  const t = userTier(user, org.compartment);
  if (t >= Number(org.min_tier || 1)) return "tiered";
  if (inSchatten(user)) return "bare";
  return null;
}

// What a user may see of a person filed at `tier` in `org`. `person` is the
// record itself (or anything carrying its `division`), used on open tabs:
//   "full" | "redacted" (name and rank) | "bare" (nothing) | null (not shown)
export function personAccess(user, org, tier, person) {
  const a = orgAccess(user, org);
  if (a === "full") return sameDivision(user, person || {}) ? "full" : "bare";
  if (a === "tiered") return userTier(user, org.compartment) >= Number(tier) ? "full" : "redacted";
  if (a === "bare") return "bare";
  return null;
}

// Can this user see a record filed at `tier` in `compartment`, in an
// organization with `min_tier`? Tiers nest: a higher tier sees lower ones.
export function canSee(user, compartment, tier, min_tier = 1) {
  const t = userTier(user, compartment);
  return t >= Number(tier) && t >= Number(min_tier);
}

// The SQL fragment that applies the same rule in a query. Expects the
// query to join organizations AS o and select from people AS p (or reports AS r).
export function visibilityClause(user, tierExpr = "p.tier") {
  if (user.tier4) return { sql: "1 = 1", binds: [] };
  return {
    sql: `(
      (o.compartment = 'public'     AND ? >= ${tierExpr} AND ? >= o.min_tier) OR
      (o.compartment = 'secret'     AND ? >= ${tierExpr} AND ? >= o.min_tier) OR
      (o.compartment = 'government' AND ? >= ${tierExpr} AND ? >= o.min_tier)
    )`,
    binds: [
      user.tier_public, user.tier_public,
      user.tier_secret, user.tier_secret,
      user.tier_government, user.tier_government,
    ],
  };
}
