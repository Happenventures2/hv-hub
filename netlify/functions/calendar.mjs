// netlify/functions/calendar.mjs
// GET /api/calendar?email=joan@happenventures.com
// Returns today's Google Calendar events from daily_calendar cache table.

const BASE_ID = "appUDQ65M1lSnSM5p";
const TABLE_ID = "tblMVtcbtjJhCWqSo";

// Map Hub emails to Google Workspace emails where they differ
const CALENDAR_EMAIL_MAP = {
  "danny@happenventures.com": "daniel@happenventures.com",
  "celi@happenventures.com":  "cely@happenventures.com",
};

export default async (req) => {
  try {
    const url = new URL(req.url);
    const hubEmail = (url.searchParams.get("email") || "").toLowerCase();
    if (!hubEmail) return json({ error: "Missing email param" }, 400);

    const apiKey = Netlify.env.get("AIRTABLE_API_KEY");
    if (!apiKey) return json({ error: "AIRTABLE_API_KEY not configured" }, 500);

    const calEmail = CALENDAR_EMAIL_MAP[hubEmail] || hubEmail;

    const today = new Date().toISOString().slice(0, 10);
    const formula = encodeURIComponent(
      `AND({User Email}="${calEmail}", {Calendar Date}="${today}")`
    );

    const res = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=Start%20Time&sort%5B0%5D%5Bdirection%5D=asc&pageSize=50`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!res.ok) {
      const text = await res.text();
      return json({ error: "Airtable fetch failed", detail: text }, 502);
    }
    const data = await res.json();

    const events = (data.records || []).map((r) => {
      const f = r.fields || {};
      return {
        id: r.id,
        title: f["Event Title"] || "(No title)",
        start: f["Start Time"] || null,
        end: f["End Time"] || null,
        location: f["Location"] || null,
        meetingLink: f["Meeting Link"] || null,
        attendees: f["Attendees"] || null,
        googleEventId: f["Google Event ID"] || null,
      };
    });

    return json({
      email: hubEmail,
      calendarEmail: calEmail,
      date: today,
      events,
      count: events.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const config = { path: "/api/calendar" };
