// netlify/functions/update-task.mjs
const TASKS_BASE_ID = "appGDkdfPiiZ2lwO2";
const TASKS_TABLE_ID = "tblI12xpnUKg9T8Cm";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { recordId, status, completionDate } = await req.json();
    if (!recordId || !status) return json({ error: "Missing recordId or status" }, 400);
    const apiKey = Netlify.env.get("AIRTABLE_API_KEY");
    if (!apiKey) return json({ error: "AIRTABLE_API_KEY not configured" }, 500);

    const fields = { Status: status };
    if (status === "Closed" && !completionDate) {
      fields["Completion Date"] = new Date().toISOString().slice(0, 10);
    } else if (completionDate) {
      fields["Completion Date"] = completionDate;
    }

    const url = `https://api.airtable.com/v0/${TASKS_BASE_ID}/${TASKS_TABLE_ID}/${recordId}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });

    if (!res.ok) {
      const text = await res.text();
      return json({ error: "Airtable update failed", status: res.status, detail: text }, 502);
    }
    return json({ ok: true, fields });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const config = { path: "/api/update-task" };
