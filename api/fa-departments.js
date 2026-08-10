const https = require('https');

const MONDAY_API_TOKEN = (process.env.MONDAY_API_TOKEN || '').trim();
const TASKS_COL = 'board_relation_mm24d2yh';   // "link to Department - tasks"
const DEPTS_COL = 'dropdown_mm3478cd';          // "Related Department" (deduplicated)

const agent = new https.Agent({ keepAlive: true });

function mondayApiOnce(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.monday.com', path: '/v2', method: 'POST', agent,
      headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_API_TOKEN, 'API-Version': '2024-10' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) console.error('Monday API errors:', JSON.stringify(parsed.errors).substring(0, 300));
          resolve(parsed);
        } catch (e) {
          reject(new Error('Non-JSON response: ' + data.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function mondayApi(query) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await mondayApiOnce(query); }
    catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

module.exports = async function handler(req, res) {
  if (req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { event } = req.body || {};
    if (!event?.pulseId) {
      return res.status(200).json({ message: 'No event or pulseId' });
    }

    const itemId = event.pulseId;
    const boardId = event.boardId;

    // Get the FA item's linked tasks AND current departments dropdown
    const itemRes = await mondayApi(`{
      items(ids: [${Number(itemId)}]) {
        column_values(ids: ["${TASKS_COL}", "${DEPTS_COL}"]) {
          id text
          ... on BoardRelationValue { linked_item_ids }
        }
      }
    }`);

    const cols = itemRes.data?.items?.[0]?.column_values || [];
    const linkedIds = cols.find((c) => c.id === TASKS_COL)?.linked_item_ids || [];
    const currentLabels = (cols.find((c) => c.id === DEPTS_COL)?.text || '')
      .split(',').map((s) => s.trim()).filter(Boolean);

    if (linkedIds.length === 0) {
      if (currentLabels.length === 0) {
        return res.status(200).json({ message: 'Already empty, no change' });
      }
      const colVal = JSON.stringify(JSON.stringify({ [DEPTS_COL]: { labels: [] } }));
      await mondayApi(`mutation { change_multiple_column_values(board_id: ${boardId}, item_id: ${Number(itemId)}, column_values: ${colVal}) { id } }`);
      return res.status(200).json({ message: 'No linked tasks, cleared dropdown' });
    }

    // Fetch each linked task's board name
    const idsList = linkedIds.map(Number).join(',');
    const tasksRes = await mondayApi(`{
      items(ids: [${idsList}]) {
        board { name }
      }
    }`);

    const boardNames = (tasksRes.data?.items || [])
      .map((t) => t.board?.name)
      .filter(Boolean);

    const uniqueDepts = [...new Set(boardNames)];

    if (uniqueDepts.length === 0) {
      return res.status(200).json({ message: 'No departments resolved' });
    }

    // Skip update if dropdown already matches (same set, regardless of order)
    const a = [...uniqueDepts].sort().join('|');
    const b = [...currentLabels].sort().join('|');
    if (a === b) {
      return res.status(200).json({ message: 'Already up to date', departments: uniqueDepts });
    }

    const colVal = JSON.stringify(JSON.stringify({ [DEPTS_COL]: { labels: uniqueDepts } }));
    const updateRes = await mondayApi(`mutation { change_multiple_column_values(board_id: ${boardId}, item_id: ${Number(itemId)}, column_values: ${colVal}, create_labels_if_missing: true) { id } }`);

    if (updateRes.data?.change_multiple_column_values) {
      console.log(`FA ${itemId}: set departments to [${uniqueDepts.join(', ')}]`);
      return res.status(200).json({ message: 'Updated', departments: uniqueDepts });
    }
    return res.status(200).json({ message: 'Update failed' });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
