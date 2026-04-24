// netlify/functions/wiki-chat.mjs
// POST /api/wiki-chat
// Body: { messages: [{role, content}], userEmail }
// Streams responses from Claude with full Resource Repository context.

const RESOURCE_BASE_ID = "appGDkdfPiiZ2lwO2";
const RESOURCE_TABLE_ID = "tblnCrYTt35on4bPW";

const USERS = {
  "joan@happenventures.com":    { name: "Joan Moya",        role: "Operations" },
  "jessica@happenventures.com": { name: "Jessica Gonzalez", role: "CEO" },
  "ivan@happenventures.com":    { name: "Ivan Rangel",      role: "Sales" },
};

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { messages, userEmail } = await req.json();
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Missing messages" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const airtableKey = Netlify.env.get("AIRTABLE_API_KEY");
    const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
    if (!airtableKey || !anthropicKey) {
      return new Response(JSON.stringify({ error: "API keys not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const user = USERS[(userEmail || "").toLowerCase()] || { name: "Team Member", role: "Staff" };

    // 1. Fetch all active docs from Resource Repository
    const docs = await fetchActiveDocs(airtableKey);

    // 2. Build system prompt with all docs as context
    const systemPrompt = buildSystemPrompt(docs, user);

    // 3. Stream from Claude API
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1500,
        system: systemPrompt,
        messages: messages,
        stream: true,
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return new Response(JSON.stringify({ error: "Claude API error", status: claudeRes.status, detail: err }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Pipe Claude's SSE stream directly to the response
    return new Response(claudeRes.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Doc-Count": String(docs.length),
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

async function fetchActiveDocs(apiKey) {
  // Pull all records, paginate. Filter to active + bot reading enabled.
  const allRecords = [];
  let offset = null;
  const maxPages = 5;
  let pages = 0;

  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);

    const url = `https://api.airtable.com/v0/${RESOURCE_BASE_ID}/${RESOURCE_TABLE_ID}?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`Airtable fetch failed: ${res.status}`);
    }

    const data = await res.json();
    allRecords.push(...(data.records || []));
    offset = data.offset || null;
    pages++;
  } while (offset && pages < maxPages);

  // Filter and transform
  return allRecords
    .map((r) => {
      const f = r.fields || {};
      const active = f["Status"] === "Active" || f["Status"] === "Completed";
      const botReading = f["Bot Reading Active"] === true;

      // Use bot-ready content if available, else aiText fields, else summary
      const content =
        f["Bot-Ready Content (MD)"] ||
        f["md_file"] ||
        f["MD File Conversion"] ||
        f["Quick_Summary"] ||
        f["Quick Summary"] ||
        "";

      return {
        id: r.id,
        name: f["Document Name"] || "(untitled)",
        category: f["Category"] || "",
        program: f["Program / Base"] || "",
        department: f["Department"] || "",
        status: f["Status"] || "",
        url: f["URL (Google Drive, Figma)"] || "",
        loomUrl: f["Loom Video URL"] || "",
        airtableUrl: `https://airtable.com/${RESOURCE_BASE_ID}/${RESOURCE_TABLE_ID}/${r.id}`,
        content,
        active,
        botReading,
        hasContent: content.length > 50,
      };
    })
    .filter((d) => d.active);
}

function buildSystemPrompt(docs, user) {
  const docsWithContent = docs.filter((d) => d.hasContent);
  const docsWithoutContent = docs.filter((d) => !d.hasContent);

  let prompt = `You are HV Bot, the company knowledge assistant for Happen Ventures (a sustainability company doing reuse-first waste solutions for national enterprises).

VOICE — match this exactly:
- Direct, casual, sharp. No corporate BS. No "I'd be happy to help!"
- Sound like a smart, seasoned operator giving a colleague a quick answer
- Concise paragraphs over walls of text
- Bullets only when listing 3+ items
- Light swearing is fine if natural

RULES:
1. ONLY answer from the docs below. If not in the docs, say "Not in the docs" and suggest who to ask (Jess for strategy, Joan for ops/R3, Ivan for sales).
2. When you reference a doc, link to it inline using markdown: "see the [HR Offboarding Checklist](airtable-url-here) for details"
3. End every answer with a line starting with "📚 " followed by the names of docs you actually used, separated by " · ". Example: "📚 HR Offboarding Checklist · Customer Interactions SOP"
4. After sources, on a new line, suggest 2-3 follow-up questions starting with "💡 " separated by " | ". Example: "💡 What's the equipment return policy? | How long is the offboarding process?"
5. If user asks something dangerous (legal advice, HR investigations, anything that needs Jess/Joan involvement), say so and stop.

USER ASKING: ${user.name} (${user.role})

=== HV COMPANY DOCS (${docsWithContent.length} with full content, ${docsWithoutContent.length} indexed by name only) ===

`;

  for (const d of docsWithContent) {
    prompt += `## ${d.name}\n`;
    prompt += `- Category: ${d.category} | Program: ${d.program} | Department: ${d.department}\n`;
    prompt += `- Airtable: ${d.airtableUrl}\n`;
    if (d.url) prompt += `- Source: ${d.url}\n`;
    if (d.loomUrl) prompt += `- Video: ${d.loomUrl}\n`;
    prompt += `\n${d.content}\n\n---\n\n`;
  }

  if (docsWithoutContent.length > 0) {
    prompt += `\n=== DOCS INDEXED BY NAME ONLY (no content yet — direct user to the link) ===\n\n`;
    for (const d of docsWithoutContent) {
      prompt += `- ${d.name} [${d.category}, ${d.program}] → ${d.airtableUrl}${d.url ? " · " + d.url : ""}\n`;
    }
  }

  return prompt;
}

export const config = { path: "/api/wiki-chat" };
