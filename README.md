# FLC Pathfinder Database

A web application for searching current and historical member records for the Forest Lake Seventh-day Adventist Church Pathfinder ministry in Apopka, Florida.

## Current features

- Current results: First, Last, Status, Title, and Current activities.
- Status choices: Pathfinder, Staff, Parent, Not Active; no current data means Not Active.
- Search names, periods/calendar years, Basic/Advanced/Incomplete levels, activity teams/instruments/operations, and Red Zone placements. Selections within a category use OR; selected categories combine with AND.
- Profile with Birthday, separate Pathfinder/Staff histories, read-only multiline Notes with editing through Edit Profile, and a separate earned Honors dialog.
- Add New Profile creates a person and current registration. Add to Record adds history to multiple selected profiles, reporting added, existing, and failed entries.
- Member tables sort by Status, current Class/Title priority, Last Name, then First Name before pagination.
- All stored years use `YYYY-YY`. Detailed history is explicitly associated with Pathfinder or Staff roles.
- Supabase Auth accounts retain immediate application access, independently of person Status.

See [the current schema](docs/database-schema.md) for tables, validation, examples, and future work.

## Stack and local development

React + TypeScript + Vite, Supabase PostgreSQL/Auth, the Supabase JavaScript client, and a project-local Supabase CLI.

Use Node.js 22.12+ (Node.js 24 recommended) and npm. The existing Node.js 20.17 installation can emit engine warnings and is below the supported version.

```sh
npm install
npm run dev
```

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

1. Copy `.env.example` to `.env.local` if needed.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the project's Connect panel.
3. Restart Vite after environment changes.

Only put a publishable key in the frontend. `VITE_` values are bundled into the browser; database passwords and secret/service-role keys must never go there. `src/lib/supabase.ts` initializes the client on demand and uses generated database types.

## Staff accounts

Create staff accounts in Supabase **Authentication > Users**, then sign in through the app. No allowlist entry, SQL grant, or separate approval is needed. All authenticated accounts can read, insert, and update through the API; the interface supports searching, adding records, profiles, and editing existing profile data. Authenticated users can remove history entries; deleting permanent member profiles and catalog entries remains unavailable.

Keep **Allow new users to sign up** disabled in hosted Supabase Auth settings, and anonymous sign-ins disabled. Accounts are provisioned by administrators. Local `supabase/config.toml` also disables signup. Configure hosted Auth before applying the access migration; changing the local file alone does not update hosted settings.

The September 11 migration changes `current_staff_role()` to return `editor` for any authenticated user identity. Existing RLS policies and older clients remain compatible. The old private allowlist table is retained only as historical data and is never consulted for access; its grant script is retired. Manage accounts and password resets through Supabase Auth.

## Entering records

Use **Add New Profile** in the header to create a person and current registration together. Enter names, Status, optional Birthday and Class/Title; Current Year comes from the configured club year. Click Add, then Confirm within five seconds. Record Added shows the saved profile summary. Failed saves preserve your inputs for retry.

Use **Add to Record** in the header to choose a year and one class/title, activity, event, or honor for existing profiles. PBE automatically includes all books configured for that year, with optional Area, State, Union, and Divisional results (one placement per region). Search and check recipients in the expanded modal; selected profiles appear below the results. Click Finish / Done, review the receipt, then Confirm (no timer). Only Staff titles exclude current Pathfinders. No historical-role choice is needed. New details are merged with existing history and the year is added to Years Active. The receipt separates Added, Already had this information, and Not added with reasons, hiding empty sections. Conflicts preserve existing records. Use Review failed profiles to correct or retry failures.

Use **Edit Profile** beside Close in a member popup to change existing personal details, current registration, history entries, honors, and Notes. Click **Save Changes** in the editor header to review a receipt of Added, Updated, and Removed entries, then **Confirm** to save. Confirmation has no timer; **Back to Edit** retains the draft. A successful atomic save returns to the refreshed member popup and refreshes search results. Cancel returns without saving; failures keep your draft. Stale profiles must be reopened before saving so another user's changes are not overwritten. Each non-level history section offers an Add button, including empty sections. An X on a history instance removes it from the draft; the receipt must be confirmed before it is deleted. All eight classes are shown without Add buttons; N/A means no recorded outcome. Year dropdowns run from 2010-11 through the current year, with Unknown available for history. PBE books are automatically selected from the year catalog. Current Registration sits between Notes and Levels. History instances can be removed, but Current Registration and the member profile cannot be deleted. Missing Current Registration is filled in by the editor with the configured club year and Not Active status. IDs remain internal. Do not commit member records or credentials.

Current Data uses one `current_title` array field validated against status. New Pathfinder profiles select one of the eight levels. Staff titles come from `staff_titles`; `sort_order` follows the numbered catalog in the schema. Parent/Not Active titles are null.

History years are ranges such as `2023-24`. Levels use `{ "name": "Friend", "outcome": "basic", "year": "2023-24" }`; unknown migrated dates remain null. Activities and Red Zone events always appear under Pathfinder History, regardless of current status. Staff History contains titles; honors are independent of role. The activity, event, and earned-honor tables have no `history_role` column. Drill teams are Precision, Freestyle, Adult.

The September 14 migration preserves a private administrator-only snapshot, converts legacy standalone 2024 to `2023-24` as approved, and keeps unknown level years and Drill teams unassigned. This is historical migration context, not a rule for guessing dates on new entries.

## Migrations and generated types

[The initial migration](supabase/migrations/20260908000000_pathfinder_database.sql) creates the 17 application tables, a private staff allowlist, JSON validation functions, participation triggers, search indexes, and access policies. `created_at` and `updated_at` timestamps are included on members. Subsequent migrations revise these initial tables; apply the entire migration history. The current name index uses last_name, first_name, and ID.

For a new hosted project:

```sh
npm run supabase -- login
npm run supabase -- link --project-ref YOUR_PROJECT_REF
npm run supabase -- db push --linked --dry-run
npm run supabase -- db push --linked
```

Use new migration files for later schema changes; do not edit migrations that have already been applied. See [Supabase's migration workflow](https://supabase.com/docs/guides/deployment/database-migrations).

Regenerate `src/lib/database.types.ts` after applying schema changes. Use the CLI directly to avoid npm's banner in the generated file:

```powershell
$types = & .\node_modules\.bin\supabase.cmd gen types typescript --linked --schema public
if ($LASTEXITCODE -ne 0) { throw 'Type generation failed' }
$types | Set-Content src/lib/database.types.ts -Encoding UTF8
```

For optional local Supabase, install and run Docker, then use `npm run supabase -- start`. Local Auth users are separate from the hosted project. `supabase/seed.sql` is intentionally empty. Stop local services with `npm run supabase -- stop`; Docker is not needed for hosted development or the database test suite.

## Verification

```sh
npm test
npm run test:ui
npm run lint
npm run build
```

`npm test` executes the migration in PGlite (PostgreSQL in memory) and checks validation, paired histories, search predicates, foreign keys, and role permissions using a minimal Supabase Auth contract. It does not connect to or modify the hosted project.

`npm run test:ui` uses Playwright with installed Microsoft Edge, launches a local Vite server on port 4173, and mocks Supabase responses. It verifies current result columns, range/outcome filters, role-specific profiles, earned Honors loading, retries, profile editing, change receipts, removals, save failures, and refreshed profiles, and mobile scrolling. It requires Edge and permission to launch browser processes. The database and browser suites are complementary; browser mocks do not test hosted Auth delivery.

## Project context

Start with [the code guide](docs/code-guide.md) for a beginner-friendly walkthrough, data rules, and maintenance conventions. Use `npm run format` to format maintained files and `npm run format:check` to verify their formatting.

### Frontend structure

- `src/App.tsx`: application shell, sign-in, session lifecycle, and feature entry point.
- `src/features/search/Search.tsx`: search filters, results, pagination, and opening member profiles.
- `src/features/profile/`: member history, earned honors, profile editing, and change receipts.
- `src/components/`: shared Select, MultiSelect, and Modal components.
- `src/lib/`: Supabase access, database types, data functions, and shared formatting/error helpers.

`src/features/add/` contains new-profile creation, Add to Record, and honor lookup. `App.tsx` connects page navigation and refreshes Search after saves without discarding its filters. `add_member_record` creates both registration rows atomically. `add_to_records` merges history with per-profile rollback, existing-information checks, and receipts. Apply the full migration history through `20260916040000_preserve_current_registration.sql` before using this frontend.

Read [the project context](docs/project-context.md) for ministry background, source links, and terminology. The implemented data model follows [the database schema](docs/database-schema.md); preliminary ideas in the context document are not additional implemented features.

## Shared year search

The **Years** control now applies to Levels, Extracurricular, and Red Zone Events together. Category dropdowns contain only the names and their outcome/team/instrument/operation/placement choices, never years. For example, Years = 2023-24, Levels = Basic or Advanced Friend, and Extracurricular = Snare or Teaching finds people with either selected Friend outcome AND either activity detail, each recorded in 2023-24. Multiple years match any selected year. Without years, the selected categories search all history. With only years selected, browse participation years. Calendar-year selections retain adjacent-period matching. Unknown level years cannot match a specific year.

The general Search Honors filter remains a placeholder; its future filtering must use shared years and within-category OR behavior. Add to Record honor lookup and profile honor display are implemented separately.

Add to Record supports **Unknown** years for every category. Undated history appears last with an Unknown label and does not add a Years Active entry. PBE cannot infer Bible books for an unknown year.
