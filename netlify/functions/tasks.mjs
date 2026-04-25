// netlify/functions/tasks.mjs
// GET /api/tasks?email=joan@happenventures.com&include_closed=false

const USERS = {
  "jessica@happenventures.com": { name: "Jess Gonzalez",    role: "CEO",            airtableUserId: "usrvgj9oQCGbWO0pn" },
  "joan@happenventures.com":    { name: "Joan Moya",        role: "R3 Laundry",     airtableUserId: "usru7wmWXrZ2jodLq" },
  "celi@happenventures.com":    { name: "Celi",             role: "R3 Amazon",      airtableUserId: null },
  "mario@happenventures.com":   { name: "Mario",            role: "Junk PM",        airtableUserId: null },
  "danny@happenventures.com":   { name: "Danny",            role: "Donations PM",   airtableUserId: null },
  "milos@happenventures.com":   { name: "Milos",            role: "Recycle PM",     airtableUserId: null },
  "ivan@happenventures.com":    { name: "Ivan",             role: "CGO Sales",      airtableUserId: "usroHEbrpYrhpYrVv" },
  "farid@happenventures.com":   { name: "Farid",            role: "Product Admin",  airtableUserId: null },
};
const TASKS_BASE_ID = "appGDkdfPiiZ2lwO2";
const TASKS_TABLE_ID = "tblI12xpnUKg9T8Cm";

export default async (req) => {
  try {
    const url = new URL(req.url);
    const email = (url.searchParams.get("email") || "").toLowerCase();
    const includeClosed = url.searchParams.get("include_closed") === "true";

    if (!email) return json({ error: "Missing email param" }, 400);
    const user = USERS[email];
    if (!user) return json({ error: `Unknown user: ${email}` }, 404);
    // Users without an Airtable mapping yet get an empty task list gracefully
    if (!user.airtableUserId) return json({ tasks: [], meta: { total: 0, note: "No Airtable mapping yet for this user" } }, 200);

    const apiKey = Netlify.env.get("AIRTABLE_API_KEY");
    if (!apiKey) return json({ error: "AIRTABLE_API_KEY not configured" }, 500);

    const closedFilter = includeClosed ? "" : `, {Status} != "Closed"`;
    // ARRAYJOIN on a multi-collaborator field returns DISPLAY NAMES, not user IDs.
    // So we filter by the user's display name from USERS config.
    const formula = `AND(FIND("${user.name}", ARRAYJOIN({Assigned To})) > 0 ${closedFilter})`;

    const params = new URLSearchParams({
      filterByFormula: formula,
      pageSize: "100",
      "sort[0][field]": "Due Date",
      "sort[0][direction]": "asc",
    });

    const airtableUrl = `https://api.airtable.com/v0/${TASKS_BASE_ID}/${TASKS_TABLE_ID}?${params}`;
    const res = await fetch(airtableUrl, {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });

    if (!res.ok) {
      const text = await res.text();
      return json({ error: "Airtable fetch failed", status: res.status, detail: text }, 502);
    }

    const data = await res.json();
    const today = new Date(); today.setHours(0,0,0,0);

    const tasks = (data.records || []).map((r) => {
      const f = r.fields || {};
      const due = f["Due Date"] ? new Date(f["Due Date"] + "T00:00:00") : null;
      const isOverdue = !!(due && due < today && f["Status"] !== "Closed");

      return {
        id: r.id,
        name: f["Task Name"] || "(untitled)",
        description: stripHtml(f["Task Description"] || ""),
        updates: f["Updates/Conclusion"] || "",
        status: f["Status"] || "Open",
        type: f["Type"] || null,
        priority: f["Priority"] || null,
        urgency: f["Urgency"] || null,
        department: f["Department"] || null,
        frequency: f["Frequency"] || null,
        dueDate: f["Due Date"] || null,
        overdue: isOverdue,
        assignees: (f["Assigned To"] || []).map(u => ({ name: u.name, email: u.email })),
        createdDate: f["Created Date"] || null,
        airtableUrl: `https://airtable.com/${TASKS_BASE_ID}/${TASKS_TABLE_ID}/${r.id}`,
      };
    });

    // Also fetch closed-this-week count (separate small query)
    let doneThisWeek = 0;
    try {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoIso = weekAgo.toISOString().slice(0, 10);
      const doneFormula = `AND(
        FIND("${user.name}", ARRAYJOIN({Assigned To})) > 0,
        {Status} = "Closed",
        IS_AFTER({Completion Date}, "${weekAgoIso}")
      )`.replace(/\s+/g, " ");
      const dParams = new URLSearchParams({ filterByFormula: doneFormula, pageSize: "100" });
      const dRes = await fetch(`https://api.airtable.com/v0/${TASKS_BASE_ID}/${TASKS_TABLE_ID}?${dParams}`, {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      });
      if (dRes.ok) {
        const dData = await dRes.json();
        doneThisWeek = (dData.records || []).length;
      }
    } catch (_) {}

    // Compute summary stats
    const stats = {
      total: tasks.length,
      overdue: tasks.filter(t => t.overdue).length,
      dueToday: tasks.filter(t => {
        if (!t.dueDate || t.overdue) return false;
        const d = new Date(t.dueDate + "T00:00:00");
        return d.getTime() === today.getTime();
      }).length,
      doneThisWeek,
    };

    return json({
      user: { email, name: user.name, role: user.role },
      count: tasks.length,
      stats,
      tasks,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return json({ error: err.message, stack: err.stack }, 500);
  }
};

function stripHtml(s) { return String(s).replace(/<[^>]*>/g, "").trim(); }
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const config = { path: "/api/tasks" };
