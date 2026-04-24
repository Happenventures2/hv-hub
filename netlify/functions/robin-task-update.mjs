// netlify/functions/robin-task-update.mjs
// POST /api/robin-task-update
// Body: { recordId, status, email, notes? }
//   status: "Approved" | "Rejected" | "Snoozed" | "Auto-Resolved"
//   email:  current user (used to set Resolved By)
//   notes:  optional Resolution Notes
//
// Writes Status + Resolved At + Resolved By + Resolution Notes back to Airtable.
// If the record has an n8n Callback URL, fires it asynchronously so n8n can
// execute the next action (send chase, escalate, etc.).

const USERS = {
  "joan@happenventures.com":    { resolvedByName: "Joan" },
  "jessica@happenventures.com": { resolvedByName: "Jess" },
  "ivan@happenventures.com":    { resolvedByName: "Ivan" },
  "alexis@happenventures.com":  { resolvedByName: "Alexis" },
};

const VALID_STATUSES = new Set(["Approved", "Rejected", "Snoozed", "Auto-Resolved"]);

const BASE_ID  = "appUDQ65M1lSnSM5p";
const TABLE_ID = "tbl4YywNGbJynrrdk";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const { recordId, status, email, notes } = body;

    if (!recordId || !/^rec[A-Za-z0-9]{14}$/.test(recordId)) {
      return json({ error: "Invalid or missing recordId" }, 400);
    }
    if (!status || !VALID_STATUSES.has(status)) {
      return json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(", ")}` }, 400);
    }

    const user = USERS[(email || "").toLowerCase()];
    if (!user) return json({ error: `Unknown user: ${email}` }, 404);

    const apiKey = Netlify.env.get("AIRTABLE_API_KEY");
    if (!apiKey) return json({ error: "AIRTABLE_API_KEY not configured" }, 500);

    // Build patch payload
    const patchFields = {
      "Status": status,
      "Resolved At": new Date().toISOString(),
      "Resolved By": user.resolvedByName,
    };
    if (notes && typeof notes === "string" && notes.trim()) {
      patchFields["Resolution Notes"] = notes.trim().slice(0, 5000);
    }

    // PATCH single record
    const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${recordId}`;
    const patchRes = await fetch(patchUrl, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: patchFields }),
    });

    if (!patchRes.ok) {
      const t = await patchRes.text().catch(() => "");
      return json({ error: `Airtable ${patchRes.status}`, detail: t.slice(0, 500) }, 502);
    }

    const updated = await patchRes.json();
    const callbackUrl = (updated.fields && updated.fields["n8n Callback URL"]) || null;

    // Fire n8n callback (fire-and-forget — don't block UI on it)
    let callbackFired = false;
    if (callbackUrl && /^https?:\/\//.test(callbackUrl)) {
      try {
        // Don't await — let it run in background
        fetch(callbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordId,
            status,
            resolvedBy: user.resolvedByName,
            notes: notes || "",
            taskTitle: updated.fields["Task Title"] || "",
            relatedRecordId: updated.fields["Related Record ID"] || "",
            sourceWorkflow: updated.fields["Source Workflow"] || "",
            timestamp: new Date().toISOString(),
          }),
        }).catch(err => console.error("Callback failed:", err));
        callbackFired = true;
      } catch (err) {
        console.error("Callback dispatch error:", err);
      }
    }

    return json({
      success: true,
      recordId,
      status,
      resolvedBy: user.resolvedByName,
      callbackFired,
    });
  } catch (err) {
    console.error("robin-task-update error:", err);
    return json({ error: err.message || "Unknown" }, 500);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const config = { path: "/api/robin-task-update" };
