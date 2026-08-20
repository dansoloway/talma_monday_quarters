# monday-quarter-sync

Vercel serverless webhooks that auto-sync Quarter dropdown columns on monday.com items based on their Timeline start date.

## What it does

### Legacy: `/api/webhook` (all department boards)

When an item is created or its Timeline changes, monday.com sends a webhook. The handler:

1. Fetches the item's Timeline column value
2. Parses the start date (format: `YYYY-MM-DD - YYYY-MM-DD`)
3. Calculates the correct quarter from the start month:
   - Months 1-3 → Q1
   - Months 4-6 → Q2
   - Months 7-9 → Q3
   - Months 10-12 → Q4
4. Compares to the current **Quarter** dropdown value
5. Updates if different — no-op if already correct
6. Optionally moves the item into a group titled Q1–Q4 when such a group exists

Works on any board where columns are titled `Timeline` and `Quarter` (lookup is by title, not ID).

### Year quarters: `/api/webhook-year-quarters` (Technology only for now)

Same Timeline triggers, but writes year-aware labels to **Quarter NEW**:

- Apr 2026 → `2026 - Q2`
- Labels must exist on the dropdown (`2026 - Q1` … `2027 - Q4` today). Missing labels are skipped (200, no error).
- Column resolved by title `Quarter NEW`, with fallback id `dropdown_mm6b9hp2`.
- Does **not** move items into groups (Technology has no year-quarter groups).
- Still updates `color status automation` from the Timeline end date.

**Rename pitfall:** Keep the old column titled `Quarter` (hiding it is fine). If you rename `Quarter NEW` → `Quarter` while Technology still has recipes pointing at `/api/webhook`, that old handler would write bare `Q1` onto the renamed column. Either keep both titles as-is, or turn off Technology’s old `/api/webhook` recipes after switching.

## Stack

- Node.js (raw `https` module — no dependencies)
- Vercel serverless function
- monday.com GraphQL API (v2024-10)

## Files

- `api/webhook.js` — legacy Q1–Q4 sync (unchanged)
- `api/webhook-year-quarters.js` — year-aware `YYYY - Qn` sync for Quarter NEW
- `api/fa-departments.js` — Focus Areas → Related Department sync
- `vercel.json` — Vercel build/route config
- `package.json` — minimal manifest, no dependencies

## Environment variables

- `MONDAY_API_TOKEN` — monday.com API token with write access to all relevant boards

## Deployment

```bash
npx vercel --prod
```

Webhook URLs:

- Legacy: `https://monday-quarter-sync.vercel.app/api/webhook`
- Year quarters: `https://monday-quarter-sync.vercel.app/api/webhook-year-quarters`

## monday.com setup

### All department boards (legacy)

Two triggers per board → `/api/webhook`:

1. **When an item is created**
2. **When Timeline changes** (`timerange_mm0mzy9`)

### Technology only (year quarters)

Two **additional** triggers → `/api/webhook-year-quarters`:

1. **When an item is created**
2. **When Timeline changes** (`timerange_mm0mzy9`)

Do not remove the legacy Technology recipes until you are ready to stop writing the old `Quarter` column.

## Boards using this app (Workspace: "Work Plan", id 5841490)

All **10** department task boards use `/api/webhook`:

- Full Year (5094162683)
- Technology (5094574505) — also uses `/api/webhook-year-quarters` for `Quarter NEW` (`dropdown_mm6b9hp2`)
- Resource Development - Israel / Resources - Israel (5094576859)
- H.R (5094580197)
- Pedagogy (5094581545)
- Resources - USA (5094583693)
- Finance (5094585976)
- Marketing (5100889995)
- Projects (5100890169)
- Management (5102164086)

Timeline-change webhooks use column id `timerange_mm0mzy9` on every board.

## Behavior

- Returns `{"challenge": "..."}` for monday.com webhook verification
- Skips when no Timeline is set (returns 200, no error)
- Skips when Quarter already matches (no API write, returns "already correct")
- Returns 200 even on logical no-ops to keep monday.com webhook healthy

## Related projects

- `monday-recurrence` — recurring task generation (same 10 department boards; also writes Quarter NEW when present)
- `talma_monday_focus_areas_dashboard` — cross-department Focus Areas UI (same 10 boards)
