// netlify/functions/bot-feedback.mjs
// POST /api/bot-feedback
// Body: { rating: 'up'|'down', question, answer, docsUsed, userEmail, mode }
// Persists the rating to the HV Bot Feedback Notion database so Jess can see
// which answers are weak and which docs need better content.

const USERS = {
  "joan@happenventures.com":    { name: "Joan Moya" },
  "jessica@happenventures.com": { name: "Jessica Gonzalez" },
  "ivan@happenventures.com":    { name: "Ivan Rangel" },
  "alexis@happenventures.com":  { name: "Alexis" },
};

// HV Bot Feedback database (Notion). Created 2026-04-24 under HV Hub master page.
const NOTION_DATA_SOURCE_ID = "8dbb285b-c769-4eb9-ae6e-e6f5b15643f6";
const NOTION_DATABASE_ID    = "75fe208d-288a-49fb-b0ff-99ca0045588e";
const NOTION_API_VERSION = "2022-06-28";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const rating = (body.rating || "").toLowerCase();
    const question = String(body.question || "").slice(0, 2000);
    const answer = String(body.answer || "").slice(0, 2000);
    const docsUsed = Array.isArray(body.docsUsed)
      ? body.docsUsed.join(", ").slice(0, 2000)
      : String(body.docsUsed || "").slice(0, 2000);
    const userEmail = String(body.userEmail || "").toLowerCase();
    const mode = String(body.mode || "HV-specific");

    if (rating !== "up" && rating !== "down") {
      return json({ error: "rating must be 'up' or 'down'" }, 400);
    }
    if (!question) return json({ error: "question required" }, 400);

    const user = USERS[userEmail];
    const userName = user ? user.name : (userEmail || "unknown");

    const notionKey = Netlify.env.get("NOTION_API_KEY");
    if (!notionKey) {
      // Non-fatal: log and return 200 so the UI doesn't surface an error to the user.
      // This way the thumbs click "works" as far as the user can see, even if persistence is down.
      console.warn("bot-feedback: NOTION_API_KEY missing, skipping persistence", {
        rating, userEmail, questionPreview: question.slice(0, 80),
      });
      return json({ ok: true, persisted: false, note: "NOTION_API_KEY not configured" });
    }

    // Validate mode against the allowed select options
    const ALLOWED_MODES = new Set(["HV-specific", "General", "Hybrid", "Off-topic"]);
    const safeMode = ALLOWED_MODES.has(mode) ? mode : "HV-specific";

    const page = {
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        Question: { title: [{ text: { content: question } }] },
        Rating: { select: { name: rating === "up" ? "Up" : "Down" } },
        "User Email": { email: userEmail || null },
        "User Name": { rich_text: [{ text: { content: userName.slice(0, 200) } }] },
        Mode: { select: { name: safeMode } },
        Answer: { rich_text: [{ text: { content: answer } }] },
        "Docs Used": { rich_text: [{ text: { content: docsUsed } }] },
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
      const errorText = await res.text().catch(() => "Unknown error");
      console.error("bot-feedback: Notion write failed", res.status, errorText);
      // Still 200 — we don't want to break the UI for a logging failure
      return json({ ok: true, persisted: false, error: `Notion ${res.status}` });
    }

    return json({ ok: true, persisted: true });
  } catch (err) {
    console.error("bot-feedback error:", err);
    // Always return ok so UI doesn't break
    return json({ ok: true, persisted: false, error: err.message });
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
