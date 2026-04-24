// netlify/functions/tickets.mjs
// GET /api/tickets?email=X
// Returns tickets from the right source for each user:
//   - Joan + Jess  → R3 Airtable Tickets table (operational tickets: complaints, equipment, etc.)
//   - Alexis       → Notion Tech Build Queue (developer tickets)
//   - Jess (CEO)   → BOTH, merged with `source` label
//   - Ivan         → empty (not currently a ticket viewer)

const USERS = {
  "joan@happenventures.com":    { name: "Joan Moya",        role: "Operations",   sources: ["airtable"] },
  "jessica@happenventures.com": { name: "Jessica Gonzalez", role: "CEO",          sources: ["airtable", "notion"], viewAll: true },
  "ivan@happenventures.com":    { name: "Ivan Rangel",      role: "Sales",        sources: [] },
  "alexis@happenventures.com":  { name: "Alexis",           role: "Tech Manager", sources: ["notion"], notionAssignee: "Alexis" },
};

// R3 Airtable
const R3_BASE_ID = "app6GEKoBtHW1iyu1";
const R3_TICKETS_TABLE_ID = "tbllQM09dx7SftpdC";

// Notion Tech Build Queue
const NOTION_DATA_SOURCE_ID = "330deb66-302f-41cb-835a-80030da6d925";
const NOTION_DATABASE_ID = "e96fef48-cdf9-49f9-8b08-c8d794894cb8";
const NOTION_API_VERSION = "2022-06-28";

const PRIORITY_RANK = { "Urgent": 5, "Critical": 5, "High": 4, "Medium": 3, "Normal": 3, "Low": 2 };

export default async (req) => {
  try {
    const url = new URL(req.url);
    const email = (url.searchParams.get("email") || "").toLowerCase();

    if (!email) return json({ error: "Missing email param" }, 400);
    const user = USERS[email];
    if (!user) return json({ error: `Unknown user: ${email}` }, 404);

    if (!user.sources || user.sources.length === 0) {
      return json({
        user: { email, name: user.name, role: user.role },
        tickets: [],
        count: 0,
        note: "No ticket access for this user.",
      });
    }

    const apiKey = Netlify.env.get("AIRTABLE_API_KEY");
    const notionKey = Netlify.env.get("NOTION_API_KEY");

    let allTickets = [];
    const errors = [];

    // Pull from Airtable R3 Tickets if needed
    if (user.sources.includes("airtable")) {
      if (!apiKey) {
        errors.push("AIRTABLE_API_KEY not configured");
      } else {
        try {
          const airtableTickets = await fetchAirtableTickets(apiKey);
          allTickets = allTickets.concat(airtableTickets);
        } catch (err) {
          errors.push(`Airtable: ${err.message}`);
        }
      }
    }

    // Pull from Notion Tech Build Queue if needed
    if (user.sources.includes("notion")) {
      if (!notionKey) {
        errors.push("NOTION_API_KEY not configured");
      } else {
        try {
          const notionTickets = await fetchNotionTickets(notionKey, user.notionAssignee);
          allTickets = allTickets.concat(notionTickets);
        } catch (err) {
          errors.push(`Notion: ${err.message}`);
        }
      }
    }

    // Sort: priority desc, then created asc (oldest first)
    allTickets.sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority] || 0;
      const pb = PRIORITY_RANK[b.priority] || 0;
      if (pa !== pb) return pb - pa;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    return json({
      user: { email, name: user.name, role: user.role, viewAll: !!user.viewAll, sources: user.sources },
      tickets: allTickets,
      count: allTickets.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (err) {
    console.error("tickets error:", err);
    return json({ error: err.message || "Unknown" }, 500);
  }
};

// ---------- Airtable R3 Tickets ----------
async function fetchAirtableTickets(apiKey) {
  // Filter: Status NOT in (Done/Closed/Completed/Resolved) — so we surface live tickets only
  // Note: Airtable doesn't easily support NOT-IN, so we use NOT(OR(...))
  const formula = `NOT(OR({Status} = "Done", {Status} = "Closed", {Status} = "Completed", {Status} = "Resolved", {Status} = "Cancelled"))`;

  const params = new URLSearchParams({
    filterByFormula: formula,
    pageSize: "100",
    "sort[0][field]": "Created",
    "sort[0][direction]": "desc",
  });

  const url = `https://api.airtable.com/v0/${R3_BASE_ID}/${R3_TICKETS_TABLE_ID}?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Airtable ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.records || []).map((rec) => {
    const f = rec.fields || {};
    const assignedTo = Array.isArray(f["Assigned to"])
      ? f["Assigned to"].map(c => c.name || c.email).filter(Boolean).join(", ")
      : "";
    return {
      id: rec.id,
      source: "R3 Ops",
      title: f["Task Name"] || "(untitled)",
      description: stripRichText(f["Task Description"]) || "",
      status: extractSelect(f["Status"]) || "Open",
      priority: extractSelect(f["Priority"]) || "Medium",
      type: extractSelect(f["Type"]) || "",
      assignee: assignedTo,
      dueDate: f["Due Date"] || null,
      createdAt: f["Created"] || rec.createdTime,
      url: `https://airtable.com/${R3_BASE_ID}/${R3_TICKETS_TABLE_ID}/${rec.id}`,
      typeOfTicket: Array.isArray(f["Type of ticket"]) ? f["Type of ticket"].map(extractSelect).filter(Boolean).join(", ") : "",
    };
  });
}

// ---------- Notion Tech Build Queue ----------
async function fetchNotionTickets(notionKey, notionAssignee) {
  const filterConditions = [
    { property: "Status", select: { does_not_equal: "Done" } },
    { property: "Status", select: { does_not_equal: "Canceled" } },
    { property: "Status", select: { does_not_equal: "💡 Idea Dump" } },
    { property: "Phase",  select: { does_not_equal: "🗄️ Archived" } },
  ];
  if (notionAssignee) {
    filterConditions.unshift({ property: "Assignee", select: { equals: notionAssignee } });
  }

  // Try data source first, fall back to database
  const tryQuery = async (endpoint) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { and: filterConditions },
        sorts: [{ timestamp: "created_time", direction: "descending" }],
        page_size: 100,
      }),
    });
    return res;
  };

  let res = await tryQuery(`https://api.notion.com/v1/data_sources/${NOTION_DATA_SOURCE_ID}/query`);
  if (!res.ok) {
    res = await tryQuery(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Notion ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.results || []).map((page) => {
    const props = page.properties || {};
    return {
      id: page.id,
      source: "Tech Queue",
      title: extractNotionTitle(props["Name"]) || "(untitled)",
      description: extractNotionRichText(props["Description"]) || "",
      status: extractNotionSelect(props["Status"]) || "Open",
      priority: extractNotionSelect(props["Priority"]) || "Medium",
      type: extractNotionSelect(props["Phase"]) || "",
      assignee: extractNotionSelect(props["Assignee"]) || "",
      dueDate: extractNotionDate(props["Due"]) || null,
      createdAt: page.created_time,
      url: page.url,
      typeOfTicket: "",
    };
  });
}

// ---------- Helpers ----------
function extractSelect(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v.name) return v.name;
  return null;
}
function stripRichText(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  return String(v);
}
function extractNotionTitle(p) {
  if (!p || !Array.isArray(p.title)) return "";
  return p.title.map(t => t.plain_text || "").join("").trim();
}
function extractNotionRichText(p) {
  if (!p || !Array.isArray(p.rich_text)) return "";
  return p.rich_text.map(t => t.plain_text || "").join("").trim();
}
function extractNotionSelect(p) {
  if (!p) return "";
  if (p.select && p.select.name) return p.select.name;
  if (p.status && p.status.name) return p.status.name;
  if (p.multi_select && Array.isArray(p.multi_select)) return p.multi_select.map(o => o.name).join(", ");
  return "";
}
function extractNotionDate(p) {
  if (!p || !p.date) return null;
  return p.date.start || null;
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const config = { path: "/api/tickets" };
