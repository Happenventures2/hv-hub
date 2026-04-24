// netlify/functions/comment.mjs
const TASKS_BASE_ID = "appGDkdfPiiZ2lwO2";
const TASKS_TABLE_ID = "tblI12xpnUKg9T8Cm";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { recordId, text, authorName } = await req.json();
    if (!recordId || !text || !text.trim()) return json({ error: "Missing recordId or text" }, 400);
    const apiKey = Netlify.env.get("AIRTABLE_API_KEY");
    if (!apiKey) return json({ error: "AIRTABLE_API_KEY not configured" }, 500);

    const recUrl = `https://api.airtable.com/v0/${TASKS_BASE_ID}/${TASKS_TABLE_ID}/${recordId}`;

    const getRes = await fetch(recUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!getRes.ok) {
      const errText = await getRes.text();
      return json({ error: "Could not read existing record", detail: errText }, 502);
    }
    const cur = await getRes.json();
    const existing = (cur.fields || {})["Updates/Conclusion"] || "";

    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const author = authorName || "Hub User";
    const newEntry = `[${stamp} · ${author}] ${text.trim()}`;
    const merged = existing ? `${existing}\n${newEntry}` : newEntry;

    const patchRes = await fetch(recUrl, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { "Updates/Conclusion": merged } }),
    });

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      return json({ error: "Airtable update failed", status: patchRes.status, detail: errText }, 502);
    }
    return json({ ok: true, appended: newEntry });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const config = { path: "/api/comment" };
