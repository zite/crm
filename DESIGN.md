# CRM: product & design brief

A B2B CRM for a sales team of 5–100: leads, companies, contacts, deals and
pipelines, activities and tasks, quotes and products, email templates and
sequences, web forms, meeting links, forecasting, reports, automations,
imports, and admin. It is a working alternative to Salesforce Sales Cloud and
HubSpot Sales Hub, with **its own point of view**. It must not look like
either of them, or like Linear. Read this fully before writing UI.

Two apps share one database:

| App | Dir | Who | Access |
| --- | --- | --- | --- |
| **CRM** | `apps/crm` | The sales team: admins, managers, reps, read-only viewers | Internal |
| **CRM Pages** | `apps/crm-pages` | Prospects and customers: web forms, meeting booking, quote acceptance, unsubscribe | External, no sign-in |

---

## 1. Point of view

1. **Relationships first, records second.** Every company has a mark, every
   person a face, every record a story. A record page reads like a dossier:
   who they are, where things stand, what happened, what happens next.
2. **Always a next step.** Every open deal and working lead shows its next
   step (the earliest open task) or says plainly that there isn't one. Home
   is a worklist, not a dashboard.
3. **Money is exact and set like print.** Amounts use tabular figures and
   right-align in tables. Headline figures are set in the serif. Weighted and
   unweighted are never confused: labels always say which.
4. **A pipeline you can hold.** Deals open on a board of stage lanes, each
   with its count and total. Dragging a card *is* the stage change. The list
   is a sortable ledger.
5. **Stay in flow.** Clicking a row opens a peek sheet; J/K walk the list
   behind it; the full page is one click away. Logging a call, note or email
   is one keystroke from any record.
6. **Decide one thing at a time.** New leads are triaged in a review deck:
   start working, convert, nurture, or disqualify with a reason.
7. **Legible for a business team.** 14px interface text, 46px rows, and words
   beside glyphs. Shortcuts exist and make the app fast, but they live in the
   palette and the `?` sheet, not on every menu row.

### Never

- **No left sidebar.** Navigation is a top bar with eight sections.
- No HubSpot orange, no Salesforce cloud-blue chrome, no indigo/violet, no
  gradient KPI cards, no emoji, no confetti.
- **No rainbow stages.** Stages are one ink scale with a progressive fill,
  not a colour per stage. Colour on a record carries meaning (won, lost,
  overdue, stalled) or is absent.
- No Inter, no lucide, no shadcn default look (`bg-muted`,
  `text-muted-foreground`, `rounded-md border shadow-sm`), and no imports from
  `@project/components/*` or `@project/ui`.
- No icon-only rows where there is room for a word. No monospace on names,
  dates or amounts. Monospace is for quote numbers only.
- No card grid holding two cards. Few items are an editorial list of rows.
- No text faded with opacity (`text-ink/50`). Use `ink-2` / `ink-3`.

---

## 2. Vocabulary (use exactly these words)

| Concept | Word | Notes |
| --- | --- | --- |
| Organization you sell to | **Company** | not Account |
| Person at a company | **Contact** | |
| Unqualified inbound or prospect person | **Lead** | statuses New → Working → Nurturing / Qualified / Disqualified |
| Turning a lead into records | **Convert** | creates or links a contact, company and optionally a deal |
| Revenue opportunity | **Deal** | not Opportunity |
| Ordered set of stages | **Pipeline** | an org can have several |
| Step in a pipeline | **Stage** | kinds: Open, Won, Lost |
| Deal close | **Won** / **Lost** | "Mark won", "Mark lost", with a lost reason |
| Logged interaction | **Activity** | kinds: Note, Call, Email, Meeting |
| To-do with a due date | **Task** | types: To-do, Call, Email, Meeting, LinkedIn |
| The earliest open task | **Next step** | "No next step" when none |
| Price-book entry | **Product** | |
| Priced proposal sent to a buyer | **Quote** | numbered `Q-1042` |
| Reusable email | **Template** | merge fields in `{{contact.first_name}}` form |
| Multi-step automated outreach | **Sequence** | contacts are **enrolled** |
| Web lead capture | **Form** | |
| Public scheduling page | **Meeting link** | |
| Revenue target | **Quota** | per rep, per month or quarter |
| Days in a stage past its limit | **Stalled** | "Stalled 12d" |
| Rule that acts on events | **Automation** | "When … then …" |
| Saved filter set | **View** | |
| Person using the app | **Teammate** / **Member** | "Owner" on records |

Tone: plain, warm and specific. Sentence case everywhere ("New deal", not
"New Deal"). No "Successfully", no exclamation marks. Empty states say what
the surface is for and offer one next step.

---

## 3. Information architecture (CRM app)

Top bar (60px, on paper): **org mark + organization name** · **Home · Leads ·
Deals · Companies · Contacts · Tasks · Outreach · Reports** · search (⌘K) ·
inbox bell with unread count · **New** (menu) · account menu (profile,
settings, shortcuts, theme). Below `lg` the section links collapse into a
menu button; between `lg` and `xl` the organization name hides.

Hash routes (`#/deals/…`), so links in emails work on any host.

| Route | Page |
| --- | --- |
| `/home` | Today: greeting, day strip (tasks due, meetings, overdue, new leads), my worklist, deals needing attention (stalled, no next step, closing soon), quota progress, recent inbox |
| `/inbox` | Notifications, two-pane reader |
| `/leads` · `/leads/review` · `/leads/:id` | Leads ledger; one-at-a-time review deck; lead page |
| `/deals` · `/deals/:id` | Pipeline board / ledger with pipeline switcher; deal page: one column of sections (stage track, next steps, buying group, line items, quotes, activity, files) beside a properties rail |
| `/quotes` · `/quotes/:id` | Quotes ledger (a tab beside Deals); quote editor |
| `/companies` · `/companies/:id/:tab?` | Companies ledger; company page (overview, contacts, deals, activity, files) |
| `/contacts` · `/contacts/:id/:tab?` | Contacts ledger; contact page |
| `/tasks` · `/tasks/meetings` · `/tasks/activity` | My tasks (today, upcoming, overdue, done, team); meetings calendar list; activity log |
| `/outreach/sequences(/:id)` · `/outreach/templates` · `/outreach/forms(/:id)` · `/outreach/meetings(/:id)` | Sequences, templates, forms, meeting links |
| `/reports` · `/reports/forecast` · `/reports/pipeline` · `/reports/activity` · `/reports/leads` · `/reports/team` | Reports |
| `/views/:id` | A saved view |
| `/settings/:section` | profile, general, members, teams, pipelines, fields, lists, products, quotes, email, routing, automations, import, export, data |

CRM Pages routes: `/f/:slug` (form; `?embed=1` for iframes), `/m/:slug`
(meeting link) and `/m/booking/:token` (manage a booking), `/q/:token`
(quote), `/u/:token` (unsubscribe).

Keyboard: `⌘K` palette · `C` new deal · `⇧C` new contact · `L` log activity on
the open record · `T` new task · `/` search the list · `?` shortcuts · `G` then
`H` home, `L` leads, `D` deals, `O` companies, `P` contacts, `T` tasks, `R`
reports, `I` inbox, `S` settings. Lists: J/K, X select, Enter open, Space peek,
Esc clear. Record properties: `S` stage/status, `A` owner, `D` close/due date.

---

## 4. Density (business-app preset: do not shrink it)

| Token | Size / line | Use |
| --- | --- | --- |
| `text-micro` | 11 / 14, uppercase, semibold, `text-ink-3` | column headers, eyebrow labels |
| `text-meta` | 13 / 18 | timestamps, counts, hints, secondary lines |
| `text-ui` | 14 / 20 | tables, menus, controls, chips, properties |
| `text-body` | 15 / 23 | prose, notes, form inputs |
| `text-title` | 17 / 24, semibold | card and section titles |
| `font-display text-display-sm` | 24 / 30 | dialog titles, record names in the sheet, empty-state headlines |
| `font-display text-display` | 32 / 38 | page titles, record names on record pages |
| `font-display text-display-lg` | 44 / 48 | hero figures (pipeline total, quota) |

| Metric | Value |
| --- | --- |
| Table row | **46px** (`h-[46px]`) |
| Button `xs` / `sm` / `md` / `lg` | 28 / 32 / 36 / 40 |
| Input | 36 (`h-9`) |
| Icons in rows and buttons | 16–18 (`size={16}`/`18`) |
| Card padding | 20–24 (`p-5 sm:p-6`) |
| Page gutter | `px-5 sm:px-8` |
| Right facts rail | 320px |

Numbers in tables and stats: `tabular`. Money renders through `<Money>`.

---

## 5. Tokens (Tailwind classes)

Surfaces: `bg-paper` (app ground) · `bg-card` (cards, sheets, popovers) ·
`bg-sunken` (wells, table header, board lanes) · `bg-hover` · `bg-pressed`.
Lines: `border-line` (hairlines) · `border-line-strong` (dividers on paper,
secondary buttons) · `border-control` (inputs).
Text: `text-ink` · `text-ink-2` (secondary) · `text-ink-3` (tertiary).
The pen: `bg-accent text-on-accent` (the ONE primary button per region),
`text-accent` (links), focus rings, `bg-accent/[0.07]` selected rows
(`dark:bg-accent/10`). Ink emphasis: `bg-primary text-on-primary` (tooltips,
toasts, dark chips).
Tones: `success` (won, done, accepted), `warning` (stalled, due soon, at risk),
`danger` (lost, overdue, failed), `info` (scheduled, sent). Text in the tone;
badge wash `bg-<tone>/10` (`dark:bg-<tone>/15`). Contrast is measured by
`node scripts/check-contrast.mjs`; don't add a colour without running it.

Radii: `rounded-xs` 4 (chips, keycaps) · `rounded-sm` 6 (menu items, small
buttons) · `rounded-md` 8 (buttons, inputs, company marks) · `rounded-lg` 12
(cards, popovers) · `rounded-xl` 16 (dialogs, sheet) · `rounded-full` (people,
counts). Shadows: `shadow-hairline` · `shadow-raised` · `shadow-pop` ·
`shadow-sheet` · `shadow-drag`. Motion: `animate-pop-in`, `animate-rise-in`,
`animate-sheet-in`, `animate-dialog-in`, `animate-bar-in`, `animate-deck-in`.

Type: Figtree (UI), Newsreader (display serif), JetBrains Mono (quote numbers).
Icons: Phosphor (`@phosphor-icons/react`), weight `regular`, `duotone` for
empty states only.

---

## 6. Signature elements

- **Company mark.** an 8px-radius square with a one- or two-letter monogram on
  a muted pigment picked deterministically from the name (or the logo when
  set). People are round avatars with initials in the member's colour.
- **Stage track.** on a deal page, the pipeline's open stages as a row of
  labelled segments; passed stages ink, current stage accent, won success,
  lost danger with the stage it was lost from. Click a segment to move.
- **Stage meter.** in rows and cards, a compact run of small bars filled up
  to the current stage, always beside the stage *name*.
- **Next step line.** the earliest open task with its due label ("Call
  Priya · tomorrow"), or "No next step" in `text-warning`.
- **Timeline.** activities and history on one rail, newest first, grouped by
  day; each activity has a kind glyph in a 28px circle, its author and time,
  and the body as prose. Upcoming meetings and open tasks pin above it.
- **Figures.** page-level totals set in Newsreader with tabular figures:
  "$1.24M open pipeline · $486K weighted".

---

## 7. Patterns

**Page header.** Eyebrow (breadcrumb or context) · serif title · one line of
description in `ink-2` · actions right (one accent primary) · tab row
underneath with counts. A tab row never changes the header above it.

**Lists (ledgers).** Header row `bg-sunken`, `text-micro uppercase font-semibold
text-ink-3`, sortable headers show a caret. Rows 46px `text-ui`, hairline
separators, hover `bg-hover/60`, selected `bg-accent/[0.07]`. Name column first
and flexible, money right-aligned, dates as `shortDate`/`timeAgo`. Filters as
chips under the toolbar; a filtered-empty state offers "Clear filters". On
mobile, rows collapse to two stacked lines.

**Record pages.** Header (mark, serif name, key facts line, primary actions),
then two columns: main (max ~860px) with tabs; right 320px facts rail of cards
(details with inline editing, next step, related records). Below `lg` the rail
stacks under the header.

**Inline editing.** A property value is a button that opens its picker
(`rounded-sm px-2 hover:bg-hover`). Empty values show the action in `ink-3`
("Set close date"). Titles edit in place (Enter saves, Esc reverts).

**Writes.** Optimistic for frequent actions (stage moves, owner, task done,
field edits): patch the cache, call, roll back with
`toast.error(errorMessage(e, 'Couldn’t …'))`, then invalidate. Success toasts
only when the result isn't visible, with Undo where it's cheap.

**Dialogs.** Serif title, fields at `text-body`, first field focused, ⌘↵
submits, Esc closes, focus returns to the trigger. Destructive actions always
confirm and say what will happen.

**Charts** (recharts). Ink for the main series, accent for "this period / you",
`line-strong` dashed gridlines, tones for semantic series (won success, lost
danger). Tooltips are ink panels. No gradients, no 3D, no pies with more than
four slices (use a bar list).

**Empty states.** Phosphor duotone icon in a 48px `bg-sunken` circle, serif
headline, one sentence, one action.

**Loading.** Skeletons shaped like the content. Never a lone page spinner.

**Dark mode.** Everything uses tokens. Check both themes before calling a
surface done. **Mobile.** Works at 390px: columns stack, tables become stacked
rows, dialogs go near full width, hover-only actions get a visible `⋯`.

**Accessibility.** Buttons are buttons; icon buttons have `aria-label` and a
tooltip; focus rings are visible; colour is never the only signal.

---

## 8. CRM Pages (public app)

A calm, trustworthy page a buyer lands on from an email. Same paper, ink and
type, but the accent is the **organization's brand colour** (Settings → General),
defaulting to the same Prussian blue. One column, max 640px (quotes 880px), the
org's logo or mark at the top, generous spacing, 15–16px body, 44px touch
targets. No app chrome, no "powered by". Every page has a clear success state
and a graceful "this link has expired" state.
