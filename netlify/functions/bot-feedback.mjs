// netlify/functions/bot-feedback.mjs
// POST /api/bot-feedback
// Body: { rating: 'up'|'down', question, answer, docsUsed, userEmail, mode }
// Persists feedback to the Airtable Audit_Log table (Bot Master DB) using
// action_type = "hub_bot_feedback_up" or "hub_bot_feedback_down".
// The full feedback payload (question, answer, docs, mode) is packed into the
// details + before_value/after_value fields so a Jess-facing view can group by
// rating to surface weak bot answers.

const USERS = {
  "joan@happenventures.com":    { name: "Joan Moya" },
  "jessica@happenventures.com": { name: "Jessica Gonzalez" },
  "ivan@happenventures.com":    { name: "Ivan Rangel" },
  "alexis@happenventures.com":  { name: "Alexis" },
};

const AUDIT_BASE_ID = "appUDQ65M1lSnSM5p";   // Bot Master DB
const AUDIT_TABLE_ID = "tblZApA0UnoBhuMzZ";  // Audit_Log

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const rating = (body.rating || "").toLowerCase();
    const question = String(body.question || "").slice(0, 1500);
    const answer = String(body.answer || "").slice(0, 1500);
    const docsUsed = Array.isArray(body.docsUsed)
      ? body.docsUsed.join(", ").slice(0, 500)
      : String(body.docsUsed || "").slice(0, 500);
    const userEmail = String(body.userEmail || "").toLowerCase();
    const mode = String(body.mode || "HV-specific");

    if (rating !== "up" && rating !== "down") {
      return json({ error: "rating must be 'up' or 'down'" }, 400);
    }
    if (!question) return json({ error: "question required" }, 400);

    const apiKey = Netlify.env.get("AIRTABLE_API_KEY");
    if (!apiKey) {
      console.warn("bot-feedback: AIRTABLE_API_KEY missing, skipping persistence");
      return json({ ok: true, persisted: false, note: "AIRTABLE_API_KEY not configured" });
    }

    const user = USERS[userEmail];
    const userName = user ? user.name : (userEmail || "unknown");

    const ALLOWED_MODES = new Set(["HV-specific", "General", "Hybrid", "Off-topic"]);
    const safeMode = ALLOWED_MODES.has(mode) ? mode : "HV-specific";

    const actionType = rating === "up" ? "hub_bot_feedback_up" : "hub_bot_feedback_down";
    // Pack everything into the available Audit_Log fields:
    // - details        = "<userName> · [<rating>] <question>"  (visible in feed)
    // - before_value   = the bot's answer (mirror of "what was said before feedback")
    // - after_value    = "Mode: <mode> · Docs: <docsUsed>"     (context tags)
    const fields = {
      "timestamp":     new Date().toISOString(),
      "action_type":   actionType,
      "user_id":       userEmail || userName,
      "channel":       "hub",
      "workflow":      "/api/bot-feedback",
      "details":       `${userName} · [${rating === "up" ? "👍" : "👎"}] ${question}`,
      "before_value":  answer,
      "after_value":   `Mode: ${safeMode} · Docs: ${docsUsed || "(none cited)"}`,
    };

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
      const errorText = await res.text().catch(() => "");
      console.error("bot-feedback: Airtable write failed", res.status, errorText);
      return json({ ok: true, persisted: false, error: `Airtable ${res.status}` });
    }

    return json({ ok: true, persisted: true });
  } catch (err) {
    console.error("bot-feedback error:", err);
    return json({ ok: true, persisted: false, error: err.message });
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
