// netlify/functions/ai-tasks.mjs
// GET /api/ai-tasks?email=X
// Returns AI-generated tasks awaiting human approval from the Bot Master DB Task Queue.
// User sees tasks where target_email matches their email + status = pending_review.
// CEO (viewAll) sees all pending_review tasks across the team.

const USERS = {
  "joan@happenventures.com":    { name: "Joan Moya",        role: "Operations" },
  "jessica@happenventures.com": { name: "Jessica Gonzalez", role: "CEO",          viewAll: true },
  "ivan@happenventures.com":    { name: "Ivan Rangel",      role: "Sales" },
  "alexis@happenventures.com":  { name: "Alexis",           role: "Tech Manager" },
};

const BASE_ID  = "appUDQ65M1lSnSM5p";   // Bot Master DB
const TABLE_ID = "tblPXhWpS79NvLmh9";   // Task Queue

export default async (req) => {
  try {
    const url = new URL(req.url);
    const email = (url.searchParams.get("email") || "").toLowerCase();

    if (!email) return json({ error: "Missing email param" }, 400);
    const user = USERS[email];
    if (!user) return json({ error: `Unknown user: ${email}` }, 404);

    const apiKey = Netlify.env.get("AIRTABLE_API_KEY");
    if (!apiKey) return json({ error: "AIRTABLE_API_KEY not configured" }, 500);

    // Filter: only pending_review (the "needs approval" status). CEO sees all reps' tasks.
    const baseFilter = `{status} = "pending_review"`;
    const formula = user.viewAll
      ? baseFilter
      : `AND(${baseFilter}, LOWER({target_email}) = "${email}")`;

    const params = new URLSearchParams({
      filterByFormula: formula,
      pageSize: "100",
      "sort[0][field]": "priority_score",
      "sort[0][direction]": "desc",
      "sort[1][field]": "created_at",
      "sort[1][direction]": "asc",
    });

    const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?${params}`;
    const res = await fetch(airtableUrl, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return json({ error: `Airtable ${res.status}`, detail: t.slice(0, 500) }, 502);
    }

    const data = await res.json();
    const aiTasks = (data.records || []).map((rec) => {
      const f = rec.fields || {};
      return {
        id: rec.id,
        taskName: f["Task Name"] || "(untitled task)",
        taskType: extractSelect(f.task_type),
        targetName: f.target_name || "",
        targetEmail: f.target_email || "",
        draftSubject: f.draft_subject || "",
        whyThisExists: f.why_this_exists || "",
        priorityScore: typeof f.priority_score === "number" ? f.priority_score : null,
        botPersona: extractSelect(f.bot_persona),
        sourceAgent: extractSelect(f.source_agent),
        sendMethod: extractSelect(f.send_method),
        companyName: f.company_name || "",
        campaignName: f.campaign_name || "",
        snoozedUntil: f.snoozed_until || null,
        airtableUrl: `https://airtable.com/${BASE_ID}/${TABLE_ID}/${rec.id}`,
        createdAt: rec.createdTime,
      };
    });

    return json({
      user: { email, name: user.name, role: user.role, viewAll: !!user.viewAll },
      aiTasks,
      count: aiTasks.length,
    });
  } catch (err) {
    console.error("ai-tasks error:", err);
    return json({ error: err.message || "Unknown" }, 500);
  }
};

function extractSelect(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v.name) return v.name;
  return null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const config = { path: "/api/ai-tasks" };
