// netlify/functions/ai-tasks.mjs
// GET /api/ai-tasks?email=X
// Returns Robin's pending operational tasks awaiting human approval.
//
// Source: Bot Master DB → Robin Tasks (tbl4YywNGbJynrrdk)
// Filter: Status = "Pending Review"
//   - Jess: sees ALL pending tasks (viewAll)
//   - Everyone else: sees tasks Assigned To them OR Unassigned
//
// Note: Jazz currently maps to Joan (per Phase 1 handoff). Add jazz@... here
// when she gets her own login.

const USERS = {
  "joan@happenventures.com":    { name: "Joan Moya",        role: "Operations",   assigneeName: "Joan" },
  "jessica@happenventures.com": { name: "Jessica Gonzalez", role: "CEO",          assigneeName: "Jess",   viewAll: true },
  "ivan@happenventures.com":    { name: "Ivan Rangel",      role: "Sales",        assigneeName: "Ivan" },
  "alexis@happenventures.com":  { name: "Alexis",           role: "Tech Manager", assigneeName: "Alexis" },
};

const BASE_ID  = "appUDQ65M1lSnSM5p";   // Bot Master DB
const TABLE_ID = "tbl4YywNGbJynrrdk";   // Robin Tasks
const MAX_RECORDS = 200;

// Field IDs (hardcoded — no schema lookups at runtime)
const F = {
  title:          "fldJOowgHzkR0V0NN",
  description:    "fldxrIcz6mWPVgAHo",
  recommendation: "fldNgeGXZN0Thgc1W",
  status:         "fldmmPAthBr4WioZY",
  priority:       "flde6RSqxXzi27kYK",
  category:       "flddeV5IiS1r8ZfzF",
  assignedTo:     "fldKrRHjqdnyCQdJn",
  relatedUrl:     "fldhRBTtJ1tFYvEMG",
  relatedRecId:   "fldd0cRyZymtqPwYt",
  sourceWorkflow: "fldhheu7yFXIE3msN",
  createdAt:      "fldsSSyJfdiMBVXnB",
  resolvedAt:     "fldAXDXrRa9LL78AQ",
  resolvedBy:     "fldUfs2azT2HiHdM1",
  resolutionNotes:"fldLIxyggGQFhdbvh",
  callbackUrl:    "fld5qFd5BdDCslVGK",
};

const PRIORITY_RANK = { "Urgent": 4, "High": 3, "Medium": 2, "Low": 1 };

export default async (req) => {
  try {
    const url = new URL(req.url);
    const email = (url.searchParams.get("email") || "").toLowerCase();

    if (!email) return json({ error: "Missing email param" }, 400);
    const user = USERS[email];
    if (!user) return json({ error: `Unknown user: ${email}` }, 404);

    const apiKey = Netlify.env.get("AIRTABLE_API_KEY");
    if (!apiKey) return json({ error: "AIRTABLE_API_KEY not configured" }, 500);

    // Filter formula: Status = "Pending Review", and (viewAll OR assigned-to-me OR Unassigned)
    let formula = `{Status} = "Pending Review"`;
    if (!user.viewAll) {
      const me = user.assigneeName.replace(/"/g, '\\"');
      formula = `AND(${formula}, OR({Assigned To} = "${me}", {Assigned To} = "Unassigned", {Assigned To} = ""))`;
    }

    let all = [];
    let offset = null;
    let pages = 0;
    do {
      const params = new URLSearchParams({
        filterByFormula: formula,
        pageSize: "100",
        "sort[0][field]": "Created At",
        "sort[0][direction]": "asc",
      });
      if (offset) params.set("offset", offset);

      const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?${params}`;
      const res = await fetch(airtableUrl, {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return json({ error: `Airtable ${res.status}`, detail: t.slice(0, 500) }, 502);
      }

      const data = await res.json();
      all = all.concat(data.records || []);
      offset = data.offset || null;
      pages++;
    } while (offset && all.length < MAX_RECORDS && pages < 5);

    // Map records → API shape
    let aiTasks = all.slice(0, MAX_RECORDS).map((rec) => {
      const f = rec.fields || {};
      return {
        id: rec.id,
        title:          f["Task Title"] || "(untitled task)",
        description:    f["Description"] || "",
        recommendation: f["Recommendation"] || "",
        status:         extractSelect(f["Status"]),
        priority:       extractSelect(f["Priority"]),
        category:       extractSelect(f["Category"]),
        assignedTo:     extractSelect(f["Assigned To"]),
        relatedUrl:     f["Related URL"] || "",
        relatedRecordId:f["Related Record ID"] || "",
        sourceWorkflow: f["Source Workflow"] || "",
        createdAt:      f["Created At"] || rec.createdTime,
        airtableUrl:    `https://airtable.com/${BASE_ID}/${TABLE_ID}/${rec.id}`,
      };
    });

    // Sort: Urgent → High → Medium → Low, then oldest first
    aiTasks.sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority] || 0;
      const pb = PRIORITY_RANK[b.priority] || 0;
      if (pa !== pb) return pb - pa;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    return json({
      user: { email, name: user.name, role: user.role, viewAll: !!user.viewAll, assigneeName: user.assigneeName },
      aiTasks,
      count: aiTasks.length,
      truncated: all.length >= MAX_RECORDS && offset != null,
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
