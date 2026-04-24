// netlify/functions/activity-log.mjs
// GET  /api/activity-log?limit=20           - read recent activity
// POST /api/activity-log                     - write one entry (fire-and-forget from other endpoints)
//
// Backed by the HV Hub Activity Log Notion database.
// Reads are filtered to the most recent N entries (default 20, max 50).

const USERS = {
  "joan@happenventures.com":    { name: "Joan Moya" },
  "jessica@happenventures.com": { name: "Jessica Gonzalez" },
  "ivan@happenventures.com":    { name: "Ivan Rangel" },
  "alexis@happenventures.com":  { name: "Alexis" },
};

const NOTION_DATA_SOURCE_ID = "d6eb6e00-d987-4823-a865-5ec2be5934aa";
const NOTION_DATABASE_ID    = "8d21e9b2-3a67-4a51-bada-8967374ae5e5";
const NOTION_API_VERSION = "2022-06-28";

const ALLOWED_ACTIONS = new Set([
  "Snooze", "Comment", "Update Status", "Bot Question",
  "Bot Feedback Up", "Bot Feedback Down", "Task Opened",
]);

export default async (req) => {
  const notionKey = Netlify.env.get("NOTION_API_KEY");

  if (req.method === "POST") {
    // Fire-and-forget write from other endpoints
    try {
      const body = await req.json().catch(() => ({}));
      const action = String(body.action || "").trim();
      if (!ALLOWED_ACTIONS.has(action)) {
        return json({ ok: false, error: `Invalid action: ${action}` }, 400);
      }
      if (!notionKey) {
        // Non-fatal: log and return ok
        console.warn("activity-log: NOTION_API_KEY missing, skipping");
        return json({ ok: true, persisted: false });
      }

      const user = USERS[String(body.userEmail || "").toLowerCase()];
      const userName = user ? user.name : (body.userEmail || "unknown");

      const page = {
        parent: { database_id: NOTION_DATABASE_ID },
        properties: {
          Detail: { title: [{ text: { content: String(body.detail || "").slice(0, 2000) || action } }] },
          Action: { select: { name: action } },
          "User Email": { email: String(body.userEmail || "").toLowerCase() || null },
          "User Name": { rich_text: [{ text: { content: userName.slice(0, 200) } }] },
          "Target Record ID": { rich_text: [{ text: { content: String(body.targetRecordId || "").slice(0, 100) } }] },
          "Target Name": { rich_text: [{ text: { content: String(body.targetName || "").slice(0, 500) } }] },
          "Source Endpoint": { rich_text: [{ text: { content: String(body.sourceEndpoint || "").slice(0, 100) } }] },
        },
      };

      const res = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionKey}`,
          "Notion-Version": NOTION_API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(page),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("activity-log write failed", res.status, t);
        return json({ ok: true, persisted: false, error: `Notion ${res.status}` });
      }
      return json({ ok: true, persisted: true });
    } catch (err) {
      console.error("activity-log POST error:", err);
      return json({ ok: true, persisted: false, error: err.message });
    }
  }

  // GET: read recent activity
  try {
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get("limit") || "20", 10);
    const limit = Math.min(Math.max(limitParam, 1), 50);

    if (!notionKey) {
      return json({ entries: [], count: 0, note: "NOTION_API_KEY not configured" });
    }

    // Try new data-source endpoint first, fall back to legacy database endpoint
    const queryBody = {
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      page_size: limit,
    };

    let queryUrl = `https://api.notion.com/v1/data_sources/${NOTION_DATA_SOURCE_ID}/query`;
    let res = await fetch(queryUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(queryBody),
    });

    // Fall back to legacy database endpoint on any 4xx
    if (!res.ok && res.status >= 400 && res.status < 500) {
      queryUrl = `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`;
      res = await fetch(queryUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionKey}`,
          "Notion-Version": NOTION_API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(queryBody),
      });
    }

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("activity-log GET failed", res.status, t);
      // Return empty entries gracefully so the Home widget shows "No activity yet" instead of an error.
      return json({
        entries: [],
        count: 0,
        warning: `Notion ${res.status} — integration may not have access to the activity log database.`,
      });
    }

    const data = await res.json();
    const entries = (data.results || []).map((page) => {
      const props = page.properties || {};
      return {
        id: page.id,
        timestamp: page.created_time,
        action: extractSelect(props.Action),
        detail: extractTitle(props.Detail),
        userEmail: props["User Email"]?.email || null,
        userName: extractText(props["User Name"]),
        targetRecordId: extractText(props["Target Record ID"]),
        targetName: extractText(props["Target Name"]),
        sourceEndpoint: extractText(props["Source Endpoint"]),
      };
    });

    return json({ entries, count: entries.length });
  } catch (err) {
    console.error("activity-log GET error:", err);
    return json({ error: err.message || "Unknown" }, 500);
  }
};

function extractTitle(prop) {
  if (!prop || !prop.title) return null;
  return prop.title.map((t) => t.plain_text || "").join("").trim() || null;
}
function extractSelect(prop) {
  if (!prop || !prop.select) return null;
  return prop.select.name || null;
}
function extractText(prop) {
  if (!prop) return null;
  const arr = prop.rich_text || prop.text || [];
  return arr.map((t) => t.plain_text || "").join("").trim() || null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
