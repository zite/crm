# CRM: build brief for contributors

A complete B2B CRM built as a Zite template: a working alternative to
Salesforce Sales Cloud and HubSpot Sales Hub for a sales team of 5–100. The bar
is **Linear-level UX at business-app density**: fast, keyboard-friendly,
optimistic, beautiful in light and dark, and with nothing that looks finished
but doesn't work.

**Read [DESIGN.md](DESIGN.md) first, it is the source of truth for how every
screen looks and reads.** Then this file, then the files it points at.

---

## 1. The product

| App | Dir | Who | Access |
| --- | --- | --- | --- |
| **CRM** `apps/crm` | staff | Admins, managers, reps, viewers | Internal |
| **CRM Pages** `apps/crm-pages` | public | Prospects and customers: forms, meeting links, quotes, unsubscribe | External, no sign-in |

A fresh install starts empty: the first person to open it becomes the Admin,
and bootstrap adds a starter "Sales" pipeline and the standard pick lists.
Sample organization (loaded by an Admin from the bottom of Settings → General, only while
the workspace has no companies, contacts, deals or leads): **Ashgrove
Software**, Portland, a B2B SaaS seller with 36 companies, about 60 contacts,
about 70 deals across two pipelines, ~500 activities, tasks, 34 leads, products,
quotas and an inbox. Everything is generated from a fixed seed and dated
relative to today. The admin who loads it owns a real slice of the work. Seed
code: `apps/crm/src/seed/*`, endpoint `seedWorkspace`; removal:
`packages/shared/server/demo.ts`, endpoint `clearDemoData`.

---

## 2. What runs where, and the local harness

- Frontend: Vite on your machine. Endpoints (`src/api/*.ts`): Zite's cloud in
  production, **so an endpoint edit does nothing until the workspace is committed and built**.
- **Locally you run everything on the review harness**: the real endpoints
  executed in Vite middleware against an in-memory Postgres (PGlite) that
  mimics Zite's quirks. Config: `apps/<app>/vite.review.config.ts` (gitignored,
  already written). Harness files: `$H` =
  `/private/tmp/claude-501/-Users-dominicwhyte-dev-zite-solutions/7c1e83d7-4692-4526-8b2a-75a4e4c443ef/scratchpad/harness`.

Start your own server on **your assigned port** (never another agent's):

```bash
cd apps/crm                       # or apps/crm-pages
REVIEW_PORT=<your port> npx vite --config vite.review.config.ts > $H/<you>-vite.log 2>&1   # run_in_background: true
# then load the sample (staff app only; the public app reads the same in-memory DB per server)
curl -s -X POST http://127.0.0.1:<port>/api/bootstrap -H 'content-type: application/json' -d '{"inputs":{}}' > /dev/null
curl -s -X POST http://127.0.0.1:<port>/api/seedWorkspace -H 'content-type: application/json' -d '{"inputs":{}}'
```

One call loads it all locally. On a slow server it returns `done: false` with a
`seededAt` and a `phase`; carry on with `{"inputs":{"resume":{"seededAt":…,"phase":…}}}`
until `done`. A second call without `resume` is refused once the sample is loaded.

The DB is in memory: restarting the server resets it, so reseed. The signed-in
user is the `review_user` cookie (default `dominic@fillout.com`, an Admin). Test
as someone else by setting that cookie: `maya.brooks@ashgrove.example`
(Manager), `daniel.okafor@ashgrove.example` (Rep), `grace.chen@ashgrove.example`
(Viewer), or `anon` (signed out, the public app's normal state).

Call endpoints directly:
`curl -s -X POST http://127.0.0.1:<port>/api/<name> -H 'content-type: application/json' -d '{"inputs":{...}}'`

Drive the UI with trusted input over CDP: `node $H/cdp.mjs steps.json --port <your port + 1000>`
(steps: go/wait/waitFor/waitText/click/clickText/type/key/eval/shot/viewport/dark/cookie;
see the header of `cdp.mjs`). `shot` takes a **path**: `"shots/<you>-home.png"`.
**Look at your screenshots.** Traps, all real: `Page.navigate` to the same
`#/route` is a no-op (use `eval: location.reload()`); a headless click doesn't
focus buttons; React inputs need trusted typing; read the DOM a tick after a
click; text is often uppercased by CSS, so `waitText` on a lowercase label fails.

After adding, renaming or deleting an endpoint file, run `npx zitejs generate`
**from the repo root**. Type-check with
`npx tsc --noEmit -p apps/crm/tsconfig.app.json` (and the same for
`apps/crm-pages`). The full `yarn check` runs in CI, and takes a while locally, at
integration.

---

## 3. Data and SQL rules (runtime failures a type-check can't see)

- Tables: SDK accessor camelCase (`zite.deals`), SQL PascalCase quoted
  (`"Deals"`); fields camelCase quoted (`"closeDate"`). System columns `id`,
  `created_at`, `updated_at` are lowercase and unquoted. **Read `.zite/db.ts`**.
- **Foreign keys are text columns** holding record ids. Join with the uuid side
  cast: `c.id::text = d."companyId"`, never `d."companyId"::uuid`.
- **Unset text is `''`, never NULL**: "unassigned" is
  `COALESCE(d."ownerId", '') = ''`. Dates, numbers and checkboxes *are* null
  when unset (`COALESCE("archived", false)`).
- `zite.sql` returns numbers/COUNT/SUM as **strings** (`num()`), date fields as
  ISO timestamps (`day()`), datetimes as ISO (`iso()`), selects as their label.
  Helpers: `@project/shared/server/sql` (`str, ref, num, numOrNull, day, iso,
  bool, json, Params, chunked, withRetry, pool, isBlank, isSet`).
- **Date arithmetic**: date fields are timestamps live. Cast before subtracting
  (`$1::date - s."rottingDays"::int`); comparisons (`"closeDate" <= $1::date`)
  are fine. Never use `CURRENT_DATE`; bind the day (the client sends `today`).
- **Never name a CTE after a table** (`WITH deals AS` breaks `"Deals"` live).
  Use `deal_counts`, `ranked`.
- `findAll` ignores `sort` and caps at 500/2000; order and aggregate in SQL.
  `zite.sql` caps at 2000 rows. `bulkCreate` takes ≤100 records (`chunked`).
  A filter value of `undefined` throws.
- **Live Zite rate-limits bursts**: never `Promise.all` a loop of writes. Write
  sequentially, or use `pool(items, 2, fn)`, and wrap retryable writes in
  `withRetry`.
- Single-select values must be one of the options in
  `@project/shared/constants`, which mirrors the live schema. **If you need a
  new option, stop**: it has to be added to the live database first.
- Money: never add dollars as floats; use `@project/shared/money` (`toCents`,
  `fromCents`, `sumMoney`, `formatMoney`). Dates: `@project/shared/dates`.

## 4. Server rules

- **Zite does not enforce `inputSchema`.** Re-parse inside `execute`:
  `parseInput(schema, input)` from `../server/input` (both apps have one).
  Throw `new ZiteError('A sentence a person can read.', 'BAD_REQUEST' |
  'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT')`.
- **Identity comes from the session**: `const actor = await getActor(context)`
  then `assertCan(actor, '<capability>')`
  (`@project/shared/server/actor`, matrix in `@project/shared/roles`). Never
  trust an actor id from input. Viewers can read everything and write nothing.
- **Public endpoints (`apps/crm-pages/src/api/*`) are unauthenticated and some
  of them write.** Every one must: re-parse input strictly, find its record by
  an unguessable token (`randomToken` from `@project/shared/tokens`), return the
  same NOT_FOUND for "missing" and "not yours", never return staff-only fields
  (owner notes, internal amounts, other people's data), and rate-limit by
  refusing obvious abuse (honeypot field, absurd payload sizes).
- Shared engine, **use it rather than re-implementing it**:
  - `server/deals.ts`: `createDeal`, `updateDeal` (the only writer of stage,
    status, close dates, stage history, won/lost side effects), `loadPipelines`.
  - `server/activities.ts`: `createActivity` (the only writer of Activities:
    it keeps last-activity dates, speed-to-lead, @mentions and sequence exits).
  - `server/tasks.ts`: `createTask`, `ensureTask(systemKey)`, `completeTask`,
    `nextStepsFor`.
  - `server/events.ts`: `logEvent({ kind, entity, actorId, summary, … })` for
    history. Summaries read after the actor's name: "moved the deal to Proposal".
  - `server/notify.ts`: `notify({ recipientIds, kind, title, body, link, … })`;
    never notifies the actor about their own action.
  - `server/email.ts`: `sendEmail`, `mergeContext`, `unsubscribeUrl`,
    `hasConsent`, `isDeliverable`. Reserved demo domains are never emailed; a
    send that can't be delivered is recorded as `Not Sent` with a reason.
  - `server/settings.ts`: `getSettings`, `updateSettings`, `appLink`, `pagesLink`.
  - `server/customFields.ts`: `loadFieldDefs`, `mergeCustomValues`.
  - `server/leadRouting.ts`: `nextLeadOwner`.
  - `server/automations.ts`: `runTrigger(trigger, payload)` after your writes.
  - `server/sequences.ts`: `enrollContacts`, `exitEnrollments`, `runDueSteps`.
- Scheduled endpoints: `schedule: { scheduleType: 'recurring', schedule: {
  frequency: 'daily', interval: 1, times: ['06:00'] }, timezone:
  'America/Los_Angeles' }`; `context.user` is **null** on scheduled runs.
- **Do not import `zod` from `packages/shared`** (root zod is v4; apps use 3).

## 5. Frontend rules

- Data: `@tanstack/react-query`. Callers and types from `zitejs/api`. Keys: `qk`
  in `src/lib/queries.ts`, each area owns a first segment; invalidate by prefix
  (`invalidate(qc, 'deals', 'timeline')`). **Every input that changes the result
  belongs in the key.** Frequent actions (stage moves, toggles, assignment,
  drags) are optimistic with rollback + `toast.error(errorMessage(e, '…'))`.
- The kit is in `src/ui` (see DESIGN.md §5–7), with `src/glyphs`,
  `src/pickers`, `src/records` (list state, keyboard nav, ledger, toolbar, bulk
  bar, save view), `src/timeline` (timeline, composer, email dialog, mentions)
  and `src/shell`. **Don't modify kit files from a feature**, if you need a
  primitive that doesn't exist, build it inside your feature folder and say so in
  the pull request.
- Copy the reference feature: **Deals** (`src/features/deals/*`,
  `src/api/listDeals.ts`, `getDeal`, `createDeal`, `updateDeals`). Open
  `/#/deals` and match its density, keyboard model, empty states and copy.
- Never a spinner for a page load, skeletons shaped like the content. Every
  list has a designed empty state *and* a filtered-empty state with "Clear
  filters". Every destructive action confirms (`useAppActions().confirm`).
- Light and dark must both look intentional; use tokens only. Responsive to
  390px: tables scroll inside their container, the page never does.
- Copy: plain, specific, human, sentence case. No "Successfully", no
  exclamation marks. Money always through `<Money>`; dates through
  `lib/format.ts`.
- **The build transform cannot parse generic JSX type arguments**
  (`<OptionPicker<Status> …>`): let inference do it, or cast in the handler.
- Relative imports for your own files. `@project/shared/*` for shared code.
  **Never** `@project/components/*` or `@project/ui`, and never `lucide-react`.

## 6. Quality bar: check every item before you report done

- [ ] Every button does something real, end to end, verified on the harness
      (endpoint called, DB changed, UI updated, toast shown).
- [ ] Loading skeleton, empty state, filtered-empty state, error state.
- [ ] Keyboard: Tab order sane, Enter submits, Esc closes, focus returns to the
      trigger. Lists: J/K, X, Enter, Space, Esc via `useListNav`.
- [ ] Optimistic updates for frequent actions; no double-submit.
- [ ] Long content: a 60-character name, a 5-line note, $1,234,567.89, zero
      items, 200 items.
- [ ] Light, dark and 390px screenshots reviewed **by eye**.
- [ ] Permissions: try a write as `grace.chen@ashgrove.example` (Viewer), the
      server refuses with a readable message and the UI doesn't offer it.
- [ ] No console errors. No `undefined`, `NaN` or `[object Object]` rendered.
- [ ] `npx tsc --noEmit -p apps/<app>/tsconfig.app.json` is clean.

## 7. Adding an area

New endpoint files are fine; names must be unique and specific
(`listCompanyContacts`, not `list`). Check `apps/<app>/src/api/` for collisions
first, and run `npx zitejs generate` from the repo root afterwards.

Extension points that do not require touching shared files:

- `src/seed/<area>.ts`: export your `*_PHASES` and register them in
  `src/seed/index.ts`.
- `src/shell/CreateDialogs.tsx` is a registry; add the kind and the file path.
- Routes live in `src/App.tsx` and pages are lazy-loaded. Build pages so they
  work when mounted at the routes DESIGN.md §3 lists.

If you need a change in shared code (a kit bug, a new shared helper, a new
select option), say so in the pull request rather than working around it
locally, so the fix lands once.
