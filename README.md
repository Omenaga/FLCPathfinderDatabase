# FLC Pathfinder Database

A web application for searching current and historical member records for the Forest Lake Seventh-day Adventist Church Pathfinder ministry in Apopka, Florida.

## Current features

- Supabase PostgreSQL database with all 17 tables in [the database schema](docs/database-schema.md).
- Staff email/password sign-in, with explicit viewer/editor access.
- Search by name, member ID, active school year, level (including Advanced), extracurricular, and Red Zone event. Filters combine with AND; name search matches part of a name, ignoring case. Results are sorted by name and ID in pages of 25.
- Member details show honors, activity years paired with instruments/books/TLT operations, and Red Zone years paired with placements.
- Database constraints, foreign keys, participation validation, and row-level security support future add/edit screens. The current UI is for searching and viewing; administrators can enter records through Supabase now.

The initial migration was applied to the linked hosted project on September 8, 2026. No member data or login credentials are seeded. The first staff Auth account still needs to be created; see below.

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

## First staff account

The designated first editor is **forestlakepathfinderpics@gmail.com**. This address did not have an Auth account when the schema was deployed.

1. In the linked Supabase project's **Authentication > Users**, create that email/password user. Set the password privately in the dashboard; do not put it in the repository.
2. Run [grant-initial-staff.sql](supabase/admin/grant-initial-staff.sql) in the project's SQL Editor, or use:

   ```sh
   npm run supabase -- db query --linked --file supabase/admin/grant-initial-staff.sql
   ```

3. Sign in through the app. An empty database correctly shows no members.

This grant script fails clearly if the account does not exist and is safe to rerun. It sends no email. For other staff, a database administrator can insert their `auth.users.id` into `private.staff_access` with `role = 'viewer'` or `'editor'`. To revoke access, delete that allowlist row. Auth accounts alone do not grant access, and browser clients cannot modify the allowlist. Password resets are currently handled by the administrator through Supabase.

Viewers can read all club records. Editors can also insert and update through the API once editing screens are added. Browser deletion is disabled for both roles. All 17 application tables have row-level security; anonymous visitors have no table privileges. These policies follow [Supabase's RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Entering records and preserving relationships

Use Supabase's Table Editor or SQL Editor as an administrator for now. Create the `pathfinders` row first. Identity IDs are generated automatically; duplicate names are allowed because different members may share a name.

- JSON arrays default to `[]`. School years must be consecutive, such as `"2024-2025"`.
- `levels` contains objects such as `[{"name":"Friend","advanced":true}]`, with one entry per level name.
- Add an activity/event name to the member's core array before inserting its detail rows. The database rejects details without corresponding core participation and rejects removal of a core name while details remain.
- In Drums, PBE, and TLT, keep **one row per member and distinct string value**, with all corresponding years in that row's `years` array. For example, Snare and Bass use separate rows; additional Snare years extend the existing Snare row. A member can have multiple instruments/books/operations in one year.
- Drill has one row per member containing all Drill years.
- Red Zone has one result per member/year in each event table. Honor Evaluations and Bible Events additionally distinguish results by `name`. `placement` belongs to the year in the same row and accepts `1st Place`, `2nd Place`, `3rd Place`, or `Participation`.
- Participation may be listed before detailed years/results are entered; the UI labels those details as pending.

Keep actual member data out of source control. Tests use synthetic fixtures in an isolated database and mocked browser responses.

## Migrations and generated types

[The initial migration](supabase/migrations/20260908000000_pathfinder_database.sql) creates the 17 application tables, a private staff allowlist, JSON validation functions, participation triggers, search indexes, and access policies. `created_at` and `updated_at` timestamps are included on members. Core arrays use PostgreSQL `jsonb` with GIN indexes; the name/ID index supports result ordering.

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

For optional local Supabase, install and run Docker, then use `npm run supabase -- start`. Local Auth users and staff grants are separate from the hosted project. `supabase/seed.sql` is intentionally empty. Stop local services with `npm run supabase -- stop`; Docker is not needed for hosted development or the database test suite.

## Verification

```sh
npm test
npm run test:ui
npm run lint
npm run build
```

`npm test` executes the migration in PGlite (PostgreSQL in memory) and checks validation, paired histories, search predicates, foreign keys, and role permissions using a minimal Supabase Auth contract. It does not connect to or modify the hosted project.

`npm run test:ui` uses Playwright with installed Microsoft Edge, launches a local Vite server on port 4173, and mocks Supabase responses. It verifies sign-in, combined filters, details, empty/error states, retries, pagination, and denied staff access. It requires Edge and permission to launch browser processes. The database and browser suites are complementary; browser mocks do not test hosted Auth delivery.

## Project context

Read [the project context](docs/project-context.md) for ministry background, source links, and terminology. The implemented data model follows [the database schema](docs/database-schema.md); preliminary ideas in the context document are not additional implemented features.
