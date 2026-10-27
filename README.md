# Department of Culture

Central website of the Department of Culture, Office of the Public Advocate.

- **Public site** at `/` — built with [Eleventy](https://www.11ty.dev/) from `src/`.
- **Personnel area** at `/department/` — static documents plus two
  applications, locked by a login that runs in a Cloudflare Worker (`worker/`)
  in front of the static files:
  - **The Collection** (`/department/collection/`): dossiers on people, one
    draggable hierarchy chart per organization, a file per person with
    reports. Every record is filed at a tier (1–4, from the subject's rank)
    in a compartment (public, secret, government, from the organization),
    and a Curator only sees what their clearance allows.
  - **The People's Notes** (`/department/notes/`): everything dropped in
    **Box 70** (`/box-70/`, the public report form). Any member reads a note;
    Tier 3 in any compartment may delete one; Tier 4 may restrict one, which
    shows everyone below Tier 4 a CONFIDENTIAL card instead. Submissions are
    rate-limited per hashed IP and guarded by a honeypot field.
  - **Admin hub** (`/department/admin/`): the roll of Curators, their
    clearances and passwords, and which compartment each organization is in.
- **Database**: Cloudflare D1 (`wrangler.jsonc` → `d1_databases`). The Worker
  creates its tables and seeds organizations and ranks on first run. The
  `MEMBERS` secret is read once, on that first run, to create the first admin
  accounts; after that, users are managed in the admin hub.

## Working on it

```bash
npm install          # once
npm run dev          # public pages only, live reload at http://localhost:8080
npm run preview      # full site with login, at http://localhost:8788 (needs .dev.vars)
npm run build        # writes the site to public/
```

Copy `.dev.vars.example` to `.dev.vars` for local login. `.dev.vars` is
gitignored and never leaves your machine.

## Deploying

The Cloudflare Worker builds from the `main` branch on every push. Its
configuration is `wrangler.jsonc`; the dashboard only needs:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

No secrets are required. On first run, while the roll is empty, the personnel
entrance shows a **Found the roll** form; the first account created there is
the Director (admin, Tier 4). The form disappears once any user exists.

Optional secrets, under the Worker's **Settings → Variables and Secrets**
(the runtime ones, not the Build configuration page):

| Name | Type | Value |
| --- | --- | --- |
| `MEMBERS` | Secret | JSON of `username → { hash, name, role }`; imported as admins on first run instead of the founding form |
| `SESSION_SECRET` | Secret | signing key for sessions; without it the Worker generates one and keeps it in the database |

`/api/status` reports the installation's health (database reachable, number
of users, whether MEMBERS is present and readable) without revealing secrets.

## Clearance model

| | Reads |
| --- | --- |
| Tier 1 | Enlisted and NCO files |
| Tier 2 | + Commissioned officers |
| Tier 3 | + General ranks, heads of state, government |
| Tier 4 | Everything in every compartment, including the Party tab |

Tiers 1–3 are held per compartment (public, secret, government). Tier 4 is a
single flag. A person's tier comes from the band of their rank (the author may
raise it); their compartment comes from their organization (admins can move
an organization between compartments). Per the Division Handbooks, the
agencies and the garrison (VSK, NYPD, ABI, NSB, 1st MP, 11th, 91st) are
public (Abt. III Öffentlichkeit), civilians are secret (Abt. II Schatten),
and Government and the Party are government (Abt. I Regierung). Anyone signed in may open a file or
add a report; what they can read afterwards is decided by their clearance.

## Managing members

New members are added in the admin hub. The password set there is
temporary: at first sign-in the member is sent to `/department/password/`
and nothing else opens until they choose their own. An admin password reset
behaves the same way. Adding a member also opens their personnel record on
the Party tab (first division ticked, chosen rank); later changes to name,
rank, division or active status in the hub carry over to that record. The steps below are only for the very
first admin, before the database has any users.

Make a password hash (it asks for the password and hides your typing):

```bash
npm run hash
```

Add the printed `pbkdf2$…` string to the `MEMBERS` JSON:

```json
{
  "director": { "hash": "pbkdf2$…", "name": "Wilhelm Denker", "role": "Director" },
  "curator1": { "hash": "pbkdf2$…", "name": "…", "role": "Curator" }
}
```

Usernames are matched case-insensitively. Save the secret in Cloudflare and the
change is live at once; no redeploy needed.

## Adding a department document

Drop a Markdown file in `src/department/` with a front-matter `title`, `kicker`
and `lead`, then add it to `src/_data/deptnav.json` so it appears in the sidebar.
Anything under `/department/` is automatically behind the login.

## Layout

```
src/
  index.njk            public home page
  proclamations.njk    the Mandate as a proclamation document
  login.njk            personnel entrance
  department/          internal documents (Markdown)
  _includes/layouts/   base, public and department shells
  _includes/partials/  the emblem (SVG)
  _data/               site facts, department nav
  assets/              css, js, images
  department/collection.njk   the Collection app shell
  department/admin.njk        the admin hub shell
  assets/js/collection.js     chart, files, reports, dialog
  assets/js/admin.js          roll and organizations
worker/
  index.js             router, login, gate for /department/*
  auth.js              hashing, signing, cookies
  db.js                schema, first-run setup, clearance rule
  seed.js              organizations and ranks from the ranking sheet
  collection.js        people, files, reports, positions
  admin.js             users and organizations
wrangler.jsonc         Worker + static assets + D1 configuration
scripts/hash-password.mjs
```
