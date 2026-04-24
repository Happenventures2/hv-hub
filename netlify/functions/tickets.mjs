// netlify/functions/tickets.mjs
// GET /api/tickets?email=alexis@happenventures.com
// Pulls tickets from the Notion Tech Build Queue data source, filtered by the current user's Notion-assignee mapping.
// Returns empty list when the user has no assignee mapping (e.g. non-dev roles).

const USERS = {
  "joan@happenventures.com":    { name: "Joan Moya",        role: "Operations",   notionAssignee: null },
  "jessica@happenventures.com": { name: "Jessica Gonzalez", role: "CEO",          notionAssignee: null },
  "ivan@happenventures.com":    { name: "Ivan Rangel",      role: "Sales",        notionAssignee: null },
  "alexis@happenventures.com":  { name: "Alexis",           role: "Tech Manager", notionAssignee: "Alexis" },
};

// Notion Tech Build Queue.
// Primary: data source ID (new API). Fallback: database ID (legacy API).
// Both point to the same table; Notion supports either depending on workspace migration state.
const NOTION_DATA_SOURCE_ID = "330deb66-302f-41cb-835a-80030da6d925";
const NOTION_DATABASE_ID = "e96fef48-cdf9-49f9-8b08-c8d794894cb8";
const NOTION_API_VERSION = "2022-06-28";

export default async (req) => {
  try {
    const url = new URL(req.url);
    const email = (url.searchParams.get("email") || "").toLowerCase();

    if (!email) return json({ error: "Missing email param" }, 400);
    const user = USERS[email];
    if (!user) return json({ error: `Unknown user: ${email}` }, 404);

    // Users without a notionAssignee get an empty ticket list with a helpful pointer.
    if (!user.notionAssignee) {
      return json({
        user: { email, name: user.name, role: user.role, notionAssignee: null },
        tickets: [],
        count: 0,
        note: "This user has no Notion Tech Build Queue assignee mapping.",
      });
    }

    const notionKey = Netlify.env.get("NOTION_API_KEY");
    if (!notionKey) {
      return json({
        error: "NOTION_API_KEY not configured in Netlify env. Add it as a function-scoped env var to enable tickets.",
      }, 503);
    }

    // Notion's /v1/data_sources/{id}/query endpoint returns pages. Filter by Assignee + exclude closed.
    // We use the modern data-source API (rather than /v1/databases/.../query which is being deprecated).
    const queryUrl = `https://api.notion.com/v1/data_sources/${NOTION_DATA_SOURCE_ID}/query`;
    const body = {
      filter: {
        and: [
          { property: "Assignee", select: { equals: user.notionAssignee } },
          { property: "Status", select: { does_not_equal: "Done" } },
          { property: "Status", select: { does_not_equal: "Canceled" } },
        ],
      },
      sorts: [
        // Priority is a select; sort by its internal order (P0 → P1 → P2)
        { property: "Priority", direction: "ascending" },
      ],
      page_size: 50,
    };

    const res = await fetch(queryUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      // Fall back gracefully if the data-source API isn't available for this workspace yet;
      // try the legacy database query endpoint.
      if (res.status === 404 || res.status === 400) {
        const legacyUrl = `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`;
        const legacyRes = await fetch(legacyUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${notionKey}`,
            "Notion-Version": NOTION_API_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (legacyRes.ok) {
          const legacyData = await legacyRes.json();
          return json(shapeResponse(email, user, legacyData));
        }
      }
      return json({
        error: `Notion API returned ${res.status}`,
        detail: errorText.slice(0, 500),
      }, res.status);
    }

    const data = await res.json();
    return json(shapeResponse(email, user, data));
  } catch (err) {
    console.error("tickets.mjs error:", err);
    return json({ error: err.message || "Unknown error" }, 500);
  }
};

function shapeResponse(email, user, data) {
  const tickets = (data.results || []).map((page) => {
    const props = page.properties || {};
    const title = extractTitle(props.Task);
    return {
      id: page.id,
      title: title || "(untitled)",
      priority: extractSelect(props.Priority),
      status: extractSelect(props.Status) || "Not Started",
      phase: extractSelect(props.Phase),
      department: extractSelect(props.Department),
      system: extractSelect(props.System),
      notes: extractText(props.Notes),
      devNotes: extractText(props["Dev Notes"]),
      specUrl: extractUrl(props["Spec Page"]),
      startDate: extractDate(props["Start Date"]),
      notionUrl: page.url || `https://www.notion.so/${page.id.replace(/-/g, "")}`,
      lastEdited: page.last_edited_time,
    };
  });

  return {
    user: { email, name: user.name, role: user.role, notionAssignee: user.notionAssignee },
    tickets,
    count: tickets.length,
  };
}

// --- Notion property extractors ---
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
function extractUrl(prop) {
  if (!prop) return null;
  return prop.url || null;
}
function extractDate(prop) {
  if (!prop || !prop.date) return null;
  return prop.date.start || null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
