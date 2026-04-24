// netlify/functions/robin-task-update.mjs
// POST /api/robin-task-update
// Body: { recordId, email, status?, description?, recommendation?, notes?, snoozeDays? }
//
// All fields except recordId + email are optional. Endpoint applies whatever's present:
//   status      → "Approved" | "Rejected" | "Snoozed" | "Auto-Resolved"
//                 Sets Resolved At + Resolved By
//   description → overwrites Description
//   recommendation → overwrites Recommendation
//   notes       → appends to Resolution Notes with [timestamp · author] prefix
//                 (does NOT change Status — Joan can leave a note without resolving)
//   snoozeDays  → sets Status="Snoozed" AND appends a note "[Snoozed N days, wake on YYYY-MM-DD]"
//
// If status is set to Approved AND callback URL exists on the record, fires the n8n callback
// fire-and-forget so the next workflow step can run.

const USERS = {
  "joan@happenventures.com":    { resolvedByName: "Joan",   displayName: "Joan" },
  "jessica@happenventures.com": { resolvedByName: "Jess",   displayName: "Jess" },
  "ivan@happenventures.com":    { resolvedByName: "Ivan",   displayName: "Ivan" },
  "alexis@happenventures.com":  { resolvedByName: "Alexis", displayName: "Alexis" },
};

const VALID_STATUSES = new Set(["Approved", "Rejected", "Snoozed", "Auto-Resolved", "Pending Review"]);

const BASE_ID  = "appUDQ65M1lSnSM5p";
const TABLE_ID = "tbl4YywNGbJynrrdk";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const { recordId, email, status, description, recommendation, notes, snoozeDays } = body;

    if (!recordId || !/^rec[A-Za-z0-9]{14}$/.test(recordId)) {
      return json({ error: "Invalid or missing recordId" }, 400);
    }
    const user = USERS[(email || "").toLowerCase()];
    if (!user) return json({ error: `Unknown user: ${email}` }, 404);

    const apiKey = Netlify.env.get("AIRTABLE_API_KEY");
    if (!apiKey) return json({ error: "AIRTABLE_API_KEY not configured" }, 500);

    // Read existing record so we can append to Resolution Notes (rather than overwrite)
    const recUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${recordId}`;
    const getRes = await fetch(recUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!getRes.ok) {
      const t = await getRes.text().catch(() => "");
      return json({ error: `Airtable read ${getRes.status}`, detail: t.slice(0, 500) }, 502);
    }
    const existing = await getRes.json();
    const existingNotes = (existing.fields || {})["Resolution Notes"] || "";

    // Build the patch
    const patchFields = {};
    let effectiveStatus = null;
    const now = new Date();
    const stamp = now.toISOString().slice(0, 16).replace("T", " "); // YYYY-MM-DD HH:MM

    if (status) {
      if (!VALID_STATUSES.has(status)) {
        return json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(", ")}` }, 400);
      }
      effectiveStatus = status;
    }

    // Snooze: forces status=Snoozed, appends a wake-on note
    let snoozeNote = "";
    if (snoozeDays != null) {
      const days = Number(snoozeDays);
      if (!Number.isFinite(days) || days < 0 || days > 365) {
        return json({ error: "snoozeDays must be a number 0-365" }, 400);
      }
      effectiveStatus = "Snoozed";
      const wake = new Date(now);
      wake.setDate(wake.getDate() + days);
      snoozeNote = `[Snoozed ${days}d, wake ${wake.toISOString().slice(0, 10)}]`;
    }

    if (effectiveStatus) {
      patchFields["Status"] = effectiveStatus;
      patchFields["Resolved At"] = now.toISOString();
      patchFields["Resolved By"] = user.resolvedByName;
    }

    if (typeof description === "string" && description.trim()) {
      patchFields["Description"] = description.trim().slice(0, 50000);
    }
    if (typeof recommendation === "string" && recommendation.trim()) {
      patchFields["Recommendation"] = recommendation.trim().slice(0, 50000);
    }

    // Build the appended note
    const noteParts = [];
    if (snoozeNote) noteParts.push(snoozeNote);
    if (typeof notes === "string" && notes.trim()) noteParts.push(notes.trim().slice(0, 5000));
    if (noteParts.length) {
      const newEntry = `[${stamp} · ${user.displayName}] ${noteParts.join(" — ")}`;
      patchFields["Resolution Notes"] = existingNotes ? `${existingNotes}\n${newEntry}` : newEntry;
    }

    if (Object.keys(patchFields).length === 0) {
      return json({ error: "Nothing to update" }, 400);
    }

    const patchRes = await fetch(recUrl, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: patchFields }),
    });

    if (!patchRes.ok) {
      const t = await patchRes.text().catch(() => "");
      return json({ error: `Airtable write ${patchRes.status}`, detail: t.slice(0, 500) }, 502);
    }

    const updated = await patchRes.json();
    const callbackUrl = (updated.fields && updated.fields["n8n Callback URL"]) || null;

    // Fire n8n callback only on status=Approved (the "go execute" signal)
    let callbackFired = false;
    if (effectiveStatus === "Approved" && callbackUrl && /^https?:\/\//.test(callbackUrl)) {
      try {
        fetch(callbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordId,
            status: effectiveStatus,
            resolvedBy: user.resolvedByName,
            notes: notes || "",
            taskTitle: updated.fields["Task Title"] || "",
            relatedRecordId: updated.fields["Related Record ID"] || "",
            sourceWorkflow: updated.fields["Source Workflow"] || "",
            recommendation: updated.fields["Recommendation"] || "",
            timestamp: now.toISOString(),
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
      status: effectiveStatus || "unchanged",
      updatedFields: Object.keys(patchFields),
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
