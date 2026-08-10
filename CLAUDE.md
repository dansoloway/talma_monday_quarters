# monday-quarter-sync

Vercel serverless webhook that auto-syncs the Quarter dropdown column on monday.com items based on their Timeline start date.

## What it does

When an item is created or its Timeline changes, monday.com sends a webhook to `/api/webhook`. The handler:

1. Fetches the item's Timeline column value
2. Parses the start date (format: `YYYY-MM-DD - YYYY-MM-DD`)
3. Calculates the correct quarter from the start month:
   - Months 1-3 → Q1
   - Months 4-6 → Q2
   - Months 7-9 → Q3
   - Months 10-12 → Q4
4. Compares to the current Quarter dropdown value
5. Updates if different — no-op if already correct

Works on any board where columns are titled `Timeline` and `Quarter` (lookup is by title, not ID).

## Stack

- Node.js (raw `https` module — no dependencies)
- Vercel serverless function
- monday.com GraphQL API (v2024-10)

## Files

- `api/webhook.js` — single serverless function handling the webhook
- `vercel.json` — Vercel build/route config
- `package.json` — minimal manifest, no dependencies

## Environment variables

- `MONDAY_API_TOKEN` — monday.com API token with write access to all relevant boards

## Deployment

```bash
npx vercel --prod
```

Webhook URL: `https://monday-quarter-sync.vercel.app/api/webhook`

## monday.com setup

The user (Shalom) sets up the webhook trigger manually in each board's monday.com automation. Two triggers per board:

1. **When an item is created** → POST to webhook URL
2. **When Timeline changes** → POST to webhook URL

## Boards using this app (Workspace: "Work Plan - Active", id 5841490)

- Full Year (5094162683)
- Technology (5094574505)
- Resource Development - Israel (5094576859)
- H.R (5094580197)
- Pedagogy (5094581545)
- Resources - USA (5094583693)
- Finance (5094585976)

## Behavior

- Returns `{"challenge": "..."}` for monday.com webhook verification
- Skips when no Timeline is set (returns 200, no error)
- Skips when Quarter already matches (no API write, returns "already correct")
- Returns 200 even on logical no-ops to keep monday.com webhook healthy

## Related project

`monday-recurrence` — separate Vercel app handling recurring task generation. Same code style, same boards, same auth pattern.
