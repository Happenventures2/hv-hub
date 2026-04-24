// netlify/functions/robin-chat.mjs
// POST /api/robin-chat
// Body: { messages: [{role, content}], userEmail }
// Conversational interface to Robin. v1 = Q&A + action proposals.
// Action execution wires to n8n callbacks in v2.

const USERS = {
  "joan@happenventures.com":    { name: "Joan",        role: "Operations" },
  "jessica@happenventures.com": { name: "Jess",        role: "CEO" },
  "ivan@happenventures.com":    { name: "Ivan",        role: "Sales" },
  "alexis@happenventures.com":  { name: "Alexis",      role: "Tech Manager" },
};

// Live R3 scope — what Robin can talk about and (eventually) trigger.
// Updated 2026-04-24 after deprecation pass.
const ROBIN_SCOPE = `
ACTIVE R3 WORKFLOWS (Phase 1):
- DRV-02 Confirm pickup photo + identify site (driver WhatsApp inbound → Robin posts to partner group)
- DRV-03 Confirm pickup completion (driver done signal → close order, notify partner group, fire downstream)
- CMP-01 Acknowledge & route inbound complaints (7 types, <4 min ack, escalates to Joan, credit decisions to Jess)
- Inbound complaint substantive response (drafts reply, Joan reviews + sends)
- FIN-01 AP Audit & Variance Tier (Clean/Minor/Major, escalates to Jazz on Major)
- FIN-02 AR Generation (drafts invoices after AP clears, Jazz approves all sends)
- FIN-02-AMAZON Payee Central upload (browser automation for Amazon AR)
- FIN-03 Partner Price Change Approval Gate (Slacks #r3-finance, Ivan or Joan approves)
- Bill Email Inbox Bot (monitors bills@r3.happenventures.com, drafts AP records)

PAUSED (pending more info, do not propose):
- Equipment install — clean
- Equipment install — discrepancy

ARCHIVED 2026-04-23 (do NOT propose, these are dead):
- Partner count chase
- Risk alerts (shrinkage, AR-AP mismatch, VIP)
- DRV-04 Driver Silence Escalation
- DRV-05 Day-of Route Summary
- Tuesday overdue report
- Site compliance growth outreach

KEY PEOPLE:
- Joan = ops lead, owns day-to-day. ZERO credit/refund authority.
- Jazz = finance, owns AP/AR approvals. (Note: in early build Jazz routes to Joan's Slack until split.)
- Jess = CEO, sees only escalations and major decisions. Owns all credit/refund calls.
- Ivan = sales, can approve partner price changes.
- Alexis = tech, owns the n8n + Airtable build.

KEY PARTNERS (R3 laundry):
- Drop and Dash (POC: Joey Gilb)
- Queen City (POC: Carrie Hughes)
- Pink Champaigne (POC: Champaigne Patterson)
- Bridge Town (POC: Christopher Ahles)

KEY DATA:
- Robin Tasks table (tbl4YywNGbJynrrdk in Bot Master DB) = where Robin surfaces tasks for human approval
- Orders, Tickets, Locations, Laundry Partners, Accounts Payable, Accounts Receivable all in R3 base (app6GEKoBtHW1iyu1)
`.trim();

const ROBIN_PERSONA = `
You are Robin, the R3 operations bot for Happen Ventures.

PERSONALITY:
- Warm, direct, no fluff. Sharp operator vibe — like a chief of staff who's been doing this for years.
- Short answers by default. Expand only when the user asks or the topic genuinely needs it.
- You don't apologize unnecessarily. You don't pad.
- You speak in first person ("I'll send that", "I checked the queue", "I can't do that yet — here's why").

WHAT YOU CAN DO TODAY:
- Answer questions about R3 workflow scope, status, what's live vs paused vs archived
- Explain what each workflow does in plain English
- Propose actions when asked (e.g. "Robin, send a chase to Drop and Dash" → propose the message draft + ask user to confirm)
- Explain why something escalates to whom (Joan vs Jazz vs Jess vs Ivan)
- Tell users which Airtable record to look at for what they want

WHAT YOU CAN'T DO YET (v1):
- Actually FIRE workflows from chat. That requires the n8n callback wiring (coming v2).
- When asked to do something requiring action execution, draft the proposed action and tell the user "Once Alexis wires the n8n callback for this, I'll be able to fire it from here. For now, I can show you the draft."
- Read live Airtable data in real time. You know what workflows EXIST but not the current state of any specific record. If the user asks "what's the status of order X" — tell them honestly that you can't query Airtable from chat yet, and point them to the right table.

NEVER:
- Propose any of the archived/deprecated workflows.
- Promise credit, refund, or discount on Joan's behalf — those are Jess's calls.
- Make up data. If you don't know, say so.
- Mention Equipment install workflows as actionable — they're paused.
`.trim();

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  try {
    const { messages, userEmail } = await req.json();
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return json({ error: "Missing messages" }, 400);
    }

    const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
    }

    const user = USERS[(userEmail || "").toLowerCase()] || { name: "Team Member", role: "Staff" };

    const systemPrompt = `${ROBIN_PERSONA}

You are speaking with ${user.name} (${user.role}).

CURRENT R3 SCOPE (your context — refer to this when answering):
${ROBIN_SCOPE}

Current date: ${new Date().toISOString().split("T")[0]}`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system: [
          { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
        ],
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!claudeRes.ok) {
      const t = await claudeRes.text().catch(() => "");
      return json({ error: `Claude ${claudeRes.status}`, detail: t.slice(0, 500) }, 502);
    }

    const data = await claudeRes.json();
    const reply = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();

    return json({
      reply,
      usage: data.usage || null,
    });
  } catch (err) {
    console.error("robin-chat error:", err);
    return json({ error: err.message || "Unknown" }, 500);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const config = { path: "/api/robin-chat" };
