// netlify/functions/wiki-docs.mjs
// GET /api/wiki-docs
// Returns lightweight list of all active docs (for sidebar / quick-prompt suggestions).

const RESOURCE_BASE_ID = "appGDkdfPiiZ2lwO2";
const RESOURCE_TABLE_ID = "tblnCrYTt35on4bPW";

export default async () => {
  try {
    const apiKey = Netlify.env.get("AIRTABLE_API_KEY");
    if (!apiKey) return json({ error: "AIRTABLE_API_KEY not configured" }, 500);

    const allRecords = [];
    let offset = null;
    let pages = 0;
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (offset) params.set("offset", offset);
      const res = await fetch(`https://api.airtable.com/v0/${RESOURCE_BASE_ID}/${RESOURCE_TABLE_ID}?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        const text = await res.text();
        return json({ error: "Airtable fetch failed", detail: text }, 502);
      }
      const data = await res.json();
      allRecords.push(...(data.records || []));
      offset = data.offset || null;
      pages++;
    } while (offset && pages < 5);

    const docs = allRecords
      .map((r) => {
        const f = r.fields || {};
        const content = f["Bot-Ready Content (MD)"] || f["md_file"] || f["Quick Summary"] || "";
        return {
          id: r.id,
          name: f["Document Name"] || "(untitled)",
          category: f["Category"] || null,
          program: f["Program / Base"] || null,
          department: f["Department"] || null,
          status: f["Status"] || null,
          url: f["URL (Google Drive, Figma)"] || null,
          airtableUrl: `https://airtable.com/${RESOURCE_BASE_ID}/${RESOURCE_TABLE_ID}/${r.id}`,
          hasBotContent: (f["Bot-Ready Content (MD)"] || "").length > 50,
          hasAnyContent: content.length > 50,
        };
      })
      .filter((d) => d.status === "Active" || d.status === "Completed");

    // Group by category for nice display
    const byCategory = {};
    for (const d of docs) {
      const k = d.category || "Other";
      if (!byCategory[k]) byCategory[k] = [];
      byCategory[k].push({ name: d.name, id: d.id, program: d.program });
    }

    return json({
      count: docs.length,
      withBotContent: docs.filter((d) => d.hasBotContent).length,
      withAnyContent: docs.filter((d) => d.hasAnyContent).length,
      docs,
      byCategory,
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

export const config = { path: "/api/wiki-docs" };
