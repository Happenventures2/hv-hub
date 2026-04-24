// netlify/functions/activity-log.mjs
// GET  /api/activity-log?limit=20  - read recent hub activity
// POST /api/activity-log            - write one entry (fire-and-forget from other endpoints)
//
// Backed by the Airtable Audit_Log table (Bot Master DB, the SoT for system events).
// All hub actions use action_type prefixed with "hub_" so they're filterable
// from n8n workflow logs that share the table.

const USERS = {
  "joan@happenventures.com":    { name: "Joan Moya" },
  "jessica@happenventures.com": { name: "Jessica Gonzalez" },
  "ivan@happenventures.com":    { name: "Ivan Rangel" },
  "alexis@happenventures.com":  { name: "Alexis" },
};

const AUDIT_BASE_ID = "appUDQ65M1lSnSM5p";   // Bot Master DB
const AUDIT_TABLE_ID = "tblZApA0UnoBhuMzZ";  // Audit_Log

// All hub action types use this prefix so we can filter cleanly from n8n logs.
const HUB_PREFIX = "hub_";

// Map UI action names → Airtable action_type values (with prefix).
const ACTION_MAP = {
  "Snooze":              "hub_snooze",
  "Comment":             "hub_comment",
  "Update Status":       "hub_update_status",
  "Bot Question":        "hub_bot_question",
  "Bot Feedback Up":     "hub_bot_feedback_up",
  "Bot Feedback Down":   "hub_bot_feedback_down",
  "Task Opened":         "hub_task_opened",
};
const ALLOWED_ACTIONS = new Set(Object.keys(ACTION_MAP));

// Reverse map for displaying back in the UI feed.
const DISPLAY_MAP = Object.fromEntries(
  Object.entries(ACTION_MAP).map(([display, raw]) => [raw, display])
);

export default async (req) => {
  const apiKey = Netlify.env.get("AIRTABLE_API_KEY");

  if (req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const action = String(body.action || "").trim();
      if (!ALLOWED_ACTIONS.has(action)) {
        return json({ ok: false, error: `Invalid action: ${action}` }, 400);
      }
      if (!apiKey) {
        console.warn("activity-log: AIRTABLE_API_KEY missing, skipping");
        return json({ ok: true, persisted: false });
      }

      const userEmail = String(body.userEmail || "").toLowerCase();
      const user = USERS[userEmail];
      const userName = user ? user.name : (userEmail || "unknown");

      // Build the record. timestamp is a regular dateTime (not auto), so we set it explicitly.
      const fields = {
        "timestamp":     new Date().toISOString(),
        "action_type":   ACTION_MAP[action],
        "user_id":       userEmail || userName,
        "channel":       "hub",                     // distinguishes from system/email/telegram
        "workflow":      String(body.sourceEndpoint || "hub"),
        "record_id":     String(body.targetRecordId || ""),
        "details":       buildDetails(body, userName),
      };

      // typecast: true lets Airtable auto-create the new "hub_*" singleSelect options
      // and the "hub" channel option on first write.
      const url = `https://api.airtable.com/v0/${AUDIT_BASE_ID}/${AUDIT_TABLE_ID}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields, typecast: true }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("activity-log write failed", res.status, t);
        return json({ ok: true, persisted: false, error: `Airtable ${res.status}` });
      }
      return json({ ok: true, persisted: true });
    } catch (err) {
      console.error("activity-log POST error:", err);
      return json({ ok: true, persisted: false, error: err.message });
    }
  }

  // GET: read recent hub activity
  try {
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get("limit") || "20", 10);
    const limit = Math.min(Math.max(limitParam, 1), 50);

    if (!apiKey) {
      return json({ entries: [], count: 0, note: "AIRTABLE_API_KEY not configured" });
    }

    // Filter to hub actions only. FIND on a singleSelect needs string coercion via concat with "".
    const formula = `FIND("${HUB_PREFIX}", {action_type} & "") = 1`;
    const params = new URLSearchParams({
      filterByFormula: formula,
      pageSize: String(limit),
      "sort[0][field]": "timestamp",
      "sort[0][direction]": "desc",
    });

    const queryUrl = `https://api.airtable.com/v0/${AUDIT_BASE_ID}/${AUDIT_TABLE_ID}?${params}`;
    const res = await fetch(queryUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("activity-log GET failed", res.status, t);
      return json({ entries: [], count: 0, warning: `Airtable ${res.status}` });
    }

    const data = await res.json();
    const entries = (data.records || []).map((rec) => {
      const f = rec.fields || {};
      const rawAction = typeof f.action_type === "string"
        ? f.action_type
        : (f.action_type && f.action_type.name) || "";
      const displayAction = DISPLAY_MAP[rawAction] || rawAction.replace(/^hub_/, "");
      return {
        id: rec.id,
        timestamp: f.timestamp || rec.createdTime,
        action: displayAction,
        detail: stripUserPrefix(f.details || ""),
        userEmail: f.user_id || null,
        userName: extractUserName(f.details, f.user_id),
        targetRecordId: f.record_id || "",
        targetName: "",
        sourceEndpoint: f.workflow || "",
      };
    });

    return json({ entries, count: entries.length });
  } catch (err) {
    console.error("activity-log GET error:", err);
    return json({ entries: [], count: 0, error: err.message });
  }
};

// --- helpers ---

function buildDetails(body, userName) {
  // Pack target name + detail into a single multilineText field.
  // Format: "<userName> · <detail> · (<targetName>)"
  const parts = [userName];
  const detail = String(body.detail || "").slice(0, 1500);
  if (detail) parts.push(detail);
  const targetName = String(body.targetName || "").slice(0, 200);
  if (targetName && !detail.includes(targetName)) {
    parts.push(`(${targetName})`);
  }
  return parts.join(" · ");
}

function extractUserName(details, userIdFallback) {
  if (!details) return userIdFallback || "Someone";
  const first = String(details).split(" · ")[0];
  return first || userIdFallback || "Someone";
}

function stripUserPrefix(details) {
  // Remove the leading "<userName> · " we packed in
  const idx = String(details).indexOf(" · ");
  return idx >= 0 ? details.slice(idx + 3) : details;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const config = { path: "/api/activity-log" };
