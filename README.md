# HV Hub — Internal Employee Dashboard

**Live:** https://hv-hub-joan-r3-wireframe.netlify.app
**Repo:** https://github.com/Happenventures2/hv-hub
**Notion master:** https://www.notion.so/34c9bfa5a7e38194b50eeb1faff055eb

Per-user dashboard for the HV team. Universal tabs (Home / Tasks / HV Bot / Tools) plus role-specific tabs surfaced from `_users.mjs` config. Built as the **front end for Robin** — Robin's backend (n8n workflows, bot logic, automation) is a separate project; this hub READS Robin's outputs and provides a human-friendly UI on top.

---

## Quickstart for Alexis

```bash
git clone https://github.com/Happenventures2/hv-hub.git
cd hv-hub

# Local dev (requires Netlify CLI)
npm i -g netlify-cli
netlify dev   # serves on http://localhost:8888 and proxies /api/* to functions
```

The repo is **wired to Netlify auto-deploy** — push to `main` and a deploy fires within 60 sec. No build step (vanilla HTML/JS).

---

## Architecture in 60 seconds

- **Frontend:** Single `index.html` (~3000 lines, vanilla JS, no framework). HV monochrome brand (Poppins, teal `#32BDAE` micro-accents only, 0.5px borders, no emojis). Material Symbols icons.
- **Backend:** Netlify serverless functions in `netlify/functions/*.mjs` (ES modules). All self-contained — no relative imports between functions (avoids drag-deploy breakage). Each function defines its own `USERS` map.
- **No database.** Airtable + Notion are the SoT. Browser stores nothing.
- **Per-user config:** Email determines what data the user sees. Currently a hardcoded user-switcher dropdown (top-right) — to be replaced with Google SSO (HVH-06).

---

## Routes (Netlify functions)

| Route | Method | Source | Purpose |
|---|---|---|---|
| `/api/tasks?email=X` | GET | Airtable | User's open tasks + stats (overdue/dueToday/doneThisWeek) |
| `/api/snooze` | POST | Airtable | Push a task's Due Date forward N days |
| `/api/comment` | POST | Airtable | Append timestamped comment to Updates/Conclusion field |
| `/api/update-task` | POST | Airtable | Change task Status; auto-stamps Completion Date if Closed |
| `/api/meetings?email=X` | GET | Airtable | Meetings (placeholder; Google Cal integration pending — HVH-01) |
| `/api/wiki-docs` | GET | Airtable | List of active Resource Repository docs (for UI badges) |
| `/api/wiki-chat` | POST | Anthropic | Streams Claude responses with Resource Repo system prompt + prompt caching |
| `/api/tickets?email=X` | GET | Notion | Tech Build Queue tickets — Alexis sees his own; CEO sees all |
| `/api/bot-feedback` | POST | Airtable Audit_Log | Persist thumbs up/down on bot answers (action_type = `hub_bot_feedback_*`) |
| `/api/activity-log` | GET / POST | Airtable Audit_Log | Hub-wide activity stream (writes from snooze/comment/update/bot, action_type prefixed `hub_*`) |

**Storage decision:** Notion is used only for the Tech Build Queue (where dev tickets natively live). Everything else writes to Airtable — the operational SoT. Hub events go into the existing Audit_Log table (Bot Master DB) using `hub_*` prefixed action types so they're filterable from the n8n workflow logs that share the table.

---

## Environment variables

All set in Netlify (site `a79154be-d7b5-453a-9dbc-b5154f95c002`), scope `functions`, `is_secret: false`:

| Key | Used by |
|---|---|
| `AIRTABLE_API_KEY` | tasks, snooze, comment, update-task, meetings, wiki-docs, wiki-chat |
| `ANTHROPIC_API_KEY` | wiki-chat |
| `NOTION_API_KEY` | tickets, bot-feedback, activity-log |

> ⚠️ **Netlify MCP gotcha:** setting `is_secret: true` silently fails to write. Keep all keys at `is_secret: false`. (The values are never exposed to the frontend; functions read them at runtime.)

---

## Notion integration setup

The `NOTION_API_KEY` belongs to an internal integration named **HV Hub**. For the API to read the Tech Build Queue, it must be **shared with the integration**:

1. Open the database in Notion
2. Click `...` (top right) → **Connections** → search for **HV Hub** → connect

Database the integration needs access to:

| Database | URL | Used by |
|---|---|---|
| Tech Build Queue | https://www.notion.so/e96fef48cdf949f98b08c8d794894cb8 | tickets endpoint |

If a Notion call returns 404, it usually means the integration isn't shared with that database. Endpoints degrade gracefully — they return empty results + a warning rather than 500.

> **Bot Feedback** and **Activity Log** used to live in Notion but were swapped to Airtable Audit_Log on 2026-04-24. The orphan Notion databases (HV Bot Feedback, HV Hub Activity Log) can be deleted manually if not already.

---

## Airtable map

**Bot Master DB** (`appUDQ65M1lSnSM5p`):
- **Audit_Log** (`tblZApA0UnoBhuMzZ`) — n8n + hub event log. Hub writes use `action_type` prefixed with `hub_*` (e.g. `hub_snooze`, `hub_bot_feedback_up`) and `channel = "hub"`. Filter views by these to separate hub activity from n8n workflow logs.

**General Airtable** (`appGDkdfPiiZ2lwO2`):
- **Tasks** (`tblI12xpnUKg9T8Cm`) — task source for `/api/tasks`. Filter by `ARRAYJOIN({Assigned To})` because that field is `multipleCollaborators` and ARRAYJOIN returns *display names*, not user IDs.
- **Resource Repository** (`tblnCrYTt35on4bPW`) — bot knowledge. 195 docs, 148 with rich MD content. Bot reads in priority: `Bot-Ready Content (MD)` → `MD File Conversion` (aiText) → `md_file` (aiText) → `Quick Summary` → metadata only.
- **Regular Meetings** (`tblcpPeqZ6G6jzPJv`) — placeholder until Google Cal integration ships.

> ⚠️ **aiText field gotcha:** aiText fields return objects like `{state, value, isStale}`, not strings. You must extract `.value` when `state === "generated"`. See `aiTextValue()` in `wiki-chat.mjs`.

---

## User config (where to add a new HV employee)

Each function file defines its own `USERS` map at the top. To add a person, add a row in **all** of these files:
- `tasks.mjs`, `bot-feedback.mjs`, `activity-log.mjs`, `tickets.mjs`, `wiki-chat.mjs`, `meetings.mjs`

For tickets: set `notionAssignee: "Their Name"` if they're a developer (assigned dev tickets), or `viewAll: true` if they should see all tickets (CEO oversight). Otherwise leave both off and they'll see an empty Tickets view.

> 💡 **Refactor opportunity:** the `USERS` map is duplicated across 6 files. Worth consolidating into a shared `_users.mjs` import once we adopt a build step. Until then, copy-paste with care.

---

## Frontend conventions

- All inline styles forbidden. Use the CSS in `<style>` at the top of `index.html`.
- Brand tokens are CSS variables: `--color-text` (`#1D1D1D`), `--color-bg` (`#FFFFFF`), `--color-canvas` (`#FAFAF9`), `--color-accent` (teal `#32BDAE`), `--color-gray-50/100/200`, etc. **Don't hardcode colors.**
- `0.5px` borders only (`border: 1px solid var(--color-gray-100)` or `var(--color-gray-200)`).
- No emojis as UI icons. Material Symbols only.
- Toast helper: `showToast(msg, isError = false)`.
- Activity log helper: `logActivity(action, { detail, targetRecordId, targetName, sourceEndpoint })`. Allowed actions: `Snooze, Comment, Update Status, Bot Question, Bot Feedback Up, Bot Feedback Down, Task Opened`.

---

## Adding a new endpoint — checklist

1. Create `netlify/functions/<name>.mjs`. Export a default `async (req) => { ... }` returning `new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })`.
2. Self-contained — no relative imports. Copy the `USERS` map and `json()` helper inline.
3. Read env via `Netlify.env.get("KEY_NAME")`. Always handle missing-key case gracefully (return 200 with `persisted: false` for write endpoints; return empty array for read endpoints) — never break the UI for an infra issue.
4. Slice text fields to Notion's 2000-char-per-rich-text-block limit if writing to Notion.
5. Test with `netlify dev` + curl before committing.

---

## Active dev queue (Notion Tech Build Queue, filter to Alexis)

Open: https://www.notion.so/e96fef48cdf949f98b08c8d794894cb8

Current state of HV Hub tickets (HVH-prefix):

| | Ticket | Status |
|---|---|---|
| 🟢 | HVH-04 — Bot Feedback → Notion | Done |
| 🟢 | HVH-05 — Auto-refresh polling | Done |
| 🟢 | HVH-03 — Activity Log | Code done, needs Notion integration shared with database |
| 🟡 | HVH-01 — Google Calendar integration | Pending Jess's GCP service account + DWD setup |
| 🟡 | HVH-02 — Role tabs wiring (Sites/Drivers/Partners/Robin) | Coordinate with Joan for source tables |
| 🟡 | HVH-06 — Production auth (Google SSO) | Blocked on HVH-01 setup (shared OAuth app) |
| 🟡 | HVH-07 — Tools tab build | Confirm tool list with Jess first |

---

## Known issues / gotchas

- **Notion API key was exposed in chat logs during build.** Should be rotated once stable. Same for the Airtable PAT and Anthropic key.
- **47 of 195 Resource Repository docs have no bot-ready MD content** (mostly legacy decks). Bot falls back to metadata only for those.
- **No real auth.** User switcher dropdown is for prototype. Don't roll out to the team until HVH-06 (Google SSO) is in.
- **Polling interval is 60s** and pauses when tab is hidden or any modal is open. If you change the interval, update both `POLL_INTERVAL_MS` in `index.html` and the visibility-change catch-up logic.
- **The `js-extracted-from-html.js` syntax check** (run via `python3 + node --check`) is the canary I use before committing. There's no formal test suite yet.

---

## Working with Jess

Per her standing instructions:
- **All dev tasks route through the Notion Tech Build Queue.** Never Slack.
- 80/20 thinking. Speed over perfection. Lean experiments, not heavy planning.
- TL;DR first in any handoff. Recommend a path, don't list options.
- HV brand system is locked — see `/mnt/skills/organization/happen-ventures-brand-and-build/SKILL.md` if you want to deeply understand the design tokens.

When you finish a ticket: update its status to **Done** in Notion + drop a one-liner in the **Notes** field about what changed.
