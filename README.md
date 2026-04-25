# HV Hub

Single hub for all Happen Ventures team members. One repo, one Netlify site, one URL.

**Live:** https://hub.happenventures.com  
**Netlify site:** happenventures-hub  
**Repo:** https://github.com/Happenventures2/hv-hub

---

## Architecture principles

Everything is dynamic per user (eventually per role). Universal tabs (Home / Tasks / HV Bot / Tools) keep the same layout and components for everyone — content is filtered by who is selected. Same shell, different data lens. **Nothing is hardcoded to a specific user. Email is the filter key everywhere data is fetched.**

### Data sources
- **Airtable** — all operational data (tasks, deals, routes, pipelines, meetings, activity). Runtime source of truth.
- **Notion** — used ONLY for the Tech Build Queue (handoff to devs) and bot brain capture/discussion. **Notion is NEVER a runtime data source.**
- **Bot Master DB** — Airtable base `appUDQ65M1lSnSM5p` — runtime config for all HV bots/agents.

Reference: 🧠 [Bot Master Framework in Notion](https://www.notion.so/3469bfa5-a7e3-8134-a24c-c4472c09c9fa) for bot brains.

---

## Users + role tabs

| Email | Display name | Role | Role-specific tabs |
|-------|-------------|------|--------------------|
| jessica@happenventures.com | Jess Gonzalez | solutions-admin | Deals, Olivia + view-as toggle |
| joan@happenventures.com | Joan Moya | r3-laundry | Sites, Partners, Robin |
| celi@happenventures.com | Celi | r3-amazon | Sites, Partners, Robin (Amazon data filter via email) |
| mario@happenventures.com | Mario | junk-pm | Junk Pipeline, Cold Outreach (placeholder) |
| danny@happenventures.com | Danny | donations-pm | Donations Pipeline, Routes (placeholder) |
| milos@happenventures.com | Milos | recycle-pm | Recycle Pipeline (placeholder) |
| ivan@happenventures.com | Ivan | cgo-sales | Sales Pipeline, Outreach (placeholder) |
| farid@happenventures.com | Farid | product-admin | Build Queue, Agents, System Health (placeholder) + view-as toggle |

Universal tabs visible to **all users**: Home, Tasks, HV Bot, Tools.

---

## Tasks tab — always dynamic

Tasks tab filters by `?email=X` — same layout, different filtered tasks based on role. Every new user automatically inherits this — no code change needed. The filter key is `currentUserEmail()` which maps to the dropdown selection.

**API:** `/api/tasks?email=<user-email>` — handled by `netlify/functions/tasks.mjs`

---

## Role nav config

Defined in `_users.mjs` and inlined as `USER_CONFIG` in `index.html`. To add a new user or role:

1. Add entry to `USER_CONFIG` in `index.html` (and `_users.mjs` for reference)
2. Add their email to the `<select id="userSelect">` dropdown
3. Create corresponding `<section class="tab-panel" data-panel="<tab-id>">` panels in `index.html`

---

## Netlify functions

All in `netlify/functions/`:

| Function | Purpose |
|----------|---------|
| `tasks.mjs` | Fetch tasks by email from Airtable |
| `ai-tasks.mjs` | Fetch AI/bot tasks |
| `tickets.mjs` | Fetch support tickets |
| `meetings.mjs` | Fetch calendar meetings |
| `activity-log.mjs` | Fetch recent activity |
| `robin-chat.mjs` | Robin (R3 ops bot) chat handler |
| `wiki-chat.mjs` | HV Bot (wiki) chat handler |
| `bot-feedback.mjs` | Bot feedback logging |
| `comment.mjs` | Task comment handler |
| `update-task.mjs` | Task status update handler |
| `snooze.mjs` | Task snooze handler |

---

## Redirects

Old SCC site (`solutionscommandcenter.netlify.app`) redirects here via `_redirects`:
```
/* https://hub.happenventures.com/:splat 301
```
