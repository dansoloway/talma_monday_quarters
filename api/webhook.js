const https = require('https');

const MONDAY_API_TOKEN = (process.env.MONDAY_API_TOKEN || '').trim();

const TIMELINE_TITLE = 'Timeline';
const QUARTER_TITLE = 'Quarter';
const COLOR_STATUS_TITLE = 'color status automation';

const boardColumnCache = {};
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
    try {
      return await mondayApiOnce(query);
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(`Monday API attempt ${attempt} failed, retrying:`, e.message);
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

async function getBoardColumns(boardId) {
  if (boardColumnCache[boardId]) return boardColumnCache[boardId];
  const res = await mondayApi(`{ boards(ids: [${boardId}]) { columns { id title type settings_str } } }`);
  const columns = res.data?.boards?.[0]?.columns || [];
  const titleToId = {};
  columns.forEach((c) => { titleToId[c.title] = c.id; });
  boardColumnCache[boardId] = { titleToId, columns };
  return boardColumnCache[boardId];
}

function getQuarterFromMonth(month) {
  if (month <= 3) return 'Q1';
  if (month <= 6) return 'Q2';
  if (month <= 9) return 'Q3';
  return 'Q4';
}

function getDropdownIdByLabel(bc, columnId, labelText) {
  const col = bc.columns.find((c) => c.id === columnId);
  if (!col) return null;
  try {
    const settings = JSON.parse(col.settings_str || '{}');
    const label = (settings.labels || []).find((l) => l.name === labelText);
    return label ? label.id : null;
  } catch { return null; }
}

function getColorStatusLabel(endDateISO) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const endDate = new Date(endDateISO + 'T00:00:00');
  if (endDate <= today) return 'ends on or before today';
  if (endDate <= weekEnd) return 'ends this week';
  return 'ends after this week';
}

function parseIsoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }
  if (typeof value === 'object') {
    return parseIsoDate(value.date || value.from);
  }
  return null;
}

function parseTimelineFromEvent(event) {
  let value = event?.value;
  if (!value) return null;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  const inner = (value.from || value.to) ? value : (value.value || value);
  const from = parseIsoDate(inner.from);
  const to = parseIsoDate(inner.to);
  if (!from || !to) return null;
  return { from, to };
}

function parseTimelineFromText(text) {
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2}) - (\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;
  return { from: `${match[1]}-${match[2]}-${match[3]}`, to: match[4] };
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
    if (!boardId) return res.status(200).json({ message: 'No boardId in event' });

    const bc = await getBoardColumns(boardId);
    const timelineId = bc.titleToId[TIMELINE_TITLE];
    const quarterId = bc.titleToId[QUARTER_TITLE];
    const colorStatusId = bc.titleToId[COLOR_STATUS_TITLE];
    if (!timelineId) {
      return res.status(200).json({ message: 'Board missing Timeline column' });
    }

    const itemRes = await mondayApi(`{
      items(ids: [${Number(itemId)}]) {
        column_values(ids: ["${timelineId}"${quarterId ? `, "${quarterId}"` : ''}${colorStatusId ? `, "${colorStatusId}"` : ''}]) {
          id text
        }
      }
    }`);

    const item = itemRes.data?.items?.[0];
    if (!item) return res.status(200).json({ message: 'Item not found' });

    const timelineText = item.column_values.find((c) => c.id === timelineId)?.text;
    const dates = parseTimelineFromEvent(event) || parseTimelineFromText(timelineText);
    if (!dates) {
      if (!timelineText) return res.status(200).json({ message: 'No timeline set' });
      return res.status(200).json({ message: 'Invalid timeline format' });
    }

    const updates = {};
    const result = {};

    // Quarter from start month
    if (quarterId) {
      const startMonth = parseInt(dates.from.split('-')[1], 10);
      const correctQuarter = getQuarterFromMonth(startMonth);
      const currentQ = item.column_values.find((c) => c.id === quarterId)?.text;
      if (currentQ !== correctQuarter) {
        const dropdownId = getDropdownIdByLabel(bc, quarterId, correctQuarter);
        if (dropdownId) {
          updates[quarterId] = { ids: [dropdownId] };
          result.quarter = { from: currentQ || null, to: correctQuarter };
        }
      }
    }

    // Color status from end date
    if (colorStatusId) {
      const endDateISO = dates.to;
      const correctLabel = getColorStatusLabel(endDateISO);
      const currentLabel = item.column_values.find((c) => c.id === colorStatusId)?.text;
      if (currentLabel !== correctLabel) {
        updates[colorStatusId] = { label: correctLabel };
        result.colorStatus = { from: currentLabel || null, to: correctLabel };
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(200).json({ message: 'Already correct' });
    }

    const colVal = JSON.stringify(JSON.stringify(updates));
    const updateRes = await mondayApi(`mutation { change_multiple_column_values(board_id: ${boardId}, item_id: ${Number(itemId)}, column_values: ${colVal}) { id } }`);

    if (updateRes.data?.change_multiple_column_values) {
      console.log(`Updated item ${itemId} on board ${boardId}:`, JSON.stringify(result));
      return res.status(200).json({ message: 'Updated', ...result });
    }
    return res.status(200).json({ message: 'Update failed' });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
