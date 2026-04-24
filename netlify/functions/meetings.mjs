// netlify/functions/meetings.mjs
// GET /api/meetings?email=joan@happenventures.com
// Returns the user's meetings from the Regular Meetings table.

const MEETINGS_BASE_ID = "appGDkdfPiiZ2lwO2";
const MEETINGS_TABLE_ID = "tblcpPeqZ6G6jzPJv";

const USERS = {
  "joan@happenventures.com":    { name: "Joan Moya",        firstName: "Joan",    role: "Operations" },
  "jessica@happenventures.com": { name: "Jessica Gonzalez", firstName: "Jessica", role: "CEO" },
  "ivan@happenventures.com":    { name: "Ivan Rangel",      firstName: "Ivan",    role: "Sales" },
};

const DAY_INDEX = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

export default async (req) => {
  try {
    const url = new URL(req.url);
    const email = (url.searchParams.get("email") || "").toLowerCase();
    if (!email) return json({ error: "Missing email param" }, 400);
    const user = USERS[email];
    if (!user) return json({ error: `Unknown user: ${email}` }, 404);

    const apiKey = Netlify.env.get("AIRTABLE_API_KEY");
    if (!apiKey) return json({ error: "AIRTABLE_API_KEY not configured" }, 500);

    const res = await fetch(
      `https://api.airtable.com/v0/${MEETINGS_BASE_ID}/${MEETINGS_TABLE_ID}?pageSize=100`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!res.ok) {
      const text = await res.text();
      return json({ error: "Airtable fetch failed", detail: text }, 502);
    }
    const data = await res.json();

    const today = new Date();
    const todayDayIdx = today.getDay();

    // Map records → meetings, filter to those where current user is an attendee
    const meetings = (data.records || []).map((r) => {
      const f = r.fields || {};
      const attendees = (f["Attendees"] || []).map(a => a.name || "");
      const owner = (f["Meeting Owner"] || [])[0]?.name || "";

      // Loose match: user is attendee if their first name appears in any attendee name
      const isAttending = attendees.some(n =>
        n.toLowerCase().includes(user.firstName.toLowerCase())
      ) || owner.toLowerCase().includes(user.firstName.toLowerCase());

      // Parse time (decimal: 15.75 = 3:45 PM)
      const timeNum = f["Time (AST)"];
      let timeFormatted = null;
      let hourMinute = null;
      if (typeof timeNum === "number") {
        const hour = Math.floor(timeNum);
        const min = Math.round((timeNum - hour) * 60);
        timeFormatted = formatTime(hour, min);
        hourMinute = { hour, min };
      }

      const dayName = f["Day of Week"] || null;
      const dayIdx = dayName ? DAY_INDEX[dayName] : null;

      return {
        id: r.id,
        name: f["Meeting Name"] || "(untitled)",
        department: f["Department"] || null,
        periodicity: f["Periodicity"] || null,
        dayName,
        dayIdx,
        time: timeFormatted,
        hourMinute,
        owner,
        attendees,
        kpiDocUrl: f["KPI Document Link"] || null,
        airtableUrl: `https://airtable.com/${MEETINGS_BASE_ID}/${MEETINGS_TABLE_ID}/${r.id}`,
        isAttending,
        hasSchedule: dayIdx !== null && timeFormatted !== null,
      };
    });

    const userMeetings = meetings.filter(m => m.isAttending);

    // Today's meetings
    const todayMeetings = userMeetings
      .filter(m => m.hasSchedule && m.dayIdx === todayDayIdx)
      .sort((a, b) => (a.hourMinute.hour * 60 + a.hourMinute.min) - (b.hourMinute.hour * 60 + b.hourMinute.min));

    // This week ahead (today through Saturday)
    const weekAhead = userMeetings
      .filter(m => m.hasSchedule && m.dayIdx >= todayDayIdx)
      .sort((a, b) => {
        const da = (a.dayIdx - todayDayIdx) * 1440 + a.hourMinute.hour * 60 + a.hourMinute.min;
        const db = (b.dayIdx - todayDayIdx) * 1440 + b.hourMinute.hour * 60 + b.hourMinute.min;
        return da - db;
      });

    // Unscheduled (no day/time set)
    const unscheduled = userMeetings.filter(m => !m.hasSchedule);

    return json({
      user: { email, name: user.name },
      today: todayMeetings,
      weekAhead,
      unscheduled,
      totalMine: userMeetings.length,
      totalAll: meetings.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
};

function formatTime(hour, min) {
  const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm = hour >= 12 ? "PM" : "AM";
  const m = String(min).padStart(2, "0");
  return `${h}:${m} ${ampm}`;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const config = { path: "/api/meetings" };
