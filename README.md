# Department of Culture

Central website of the Department of Culture, Office of the Public Advocate.

- **Public site** at `/` — built with [Eleventy](https://www.11ty.dev/) from `src/`.
- **Personnel area** at `/department/` — same static pages, locked by a login
  that runs in a Cloudflare Worker (`worker/`) in front of the static files.
  Members and the session key live in two Cloudflare secrets; there is no
  database yet.

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

Two secrets must be set under the Worker's **Settings → Variables and
Secrets** for the login to work:

| Name | Value |
| --- | --- |
| `SESSION_SECRET` | any long random string; changing it signs everyone out |
| `MEMBERS` | JSON of `username → { hash, name, role }` (see below) |

## Managing members

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
worker/
  index.js             routes: /api/login, /api/logout, /api/me, gate for /department/*
  auth.js              hashing, signing, cookies
wrangler.jsonc         Worker + static assets configuration
scripts/hash-password.mjs
```
