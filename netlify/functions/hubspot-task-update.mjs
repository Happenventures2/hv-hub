// netlify/functions/hubspot-task-update.mjs
// POST /api/hubspot-task-update
// Body: { taskId, status, email, comment }
// Marks a HubSpot task done and/or adds a note engagement.

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const token = Netlify.env.get('HUBSPOT_PRIVATE_APP_TOKEN');
  if (!token) return json({ error: 'HubSpot token not configured' }, 500);

  try {
    const body = await req.json();
    const { taskId, status, comment } = body;

    if (!taskId) return json({ error: 'Missing taskId' }, 400);

    const results = {};

    // Mark task done if status provided
    if (status) {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: { hs_task_status: status } }),
      });
      if (!res.ok) {
        const text = await res.text();
        return json({ error: 'HubSpot update failed', detail: text }, 502);
      }
      results.statusUpdated = status;
    }

    // Add comment as a note engagement if provided
    if (comment && comment.trim()) {
      const noteRes = await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: {
            hs_note_body: comment.trim(),
            hs_timestamp: new Date().toISOString(),
          },
          associations: [{
            to: { id: taskId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 57 }],
          }],
        }),
      });
      results.commentAdded = noteRes.ok;
    }

    return json({ ok: true, ...results });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const config = { path: '/api/hubspot-task-update' };
