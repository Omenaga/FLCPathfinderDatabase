# FLC Pathfinder Database

A planned web application for storing and managing current and historical student records for the Forest Lake Seventh-day Adventist Church Pathfinder ministry in Apopka, Florida.

## Project context

Read [the project context](docs/project-context.md) for researched ministry background, source links, terminology, and preliminary application considerations. Research was last reviewed on September 8, 2026.

## Stack

- React + TypeScript with Vite.
- Supabase for hosted PostgreSQL and backend services.
- Supabase JavaScript client and project-local CLI.

Only the foundation is included: a placeholder page and a Supabase client helper. No student schema, authentication flow, or application features have been added.

## Run locally

Use Node.js 22.12+ (Node.js 24 recommended) and npm.

```sh
npm install
npm run dev
```

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

```sh
npm run lint
npm run build
npm run preview
```

## Connect Supabase

The hosted project has not yet been created or connected. Create a project in the [Supabase dashboard](https://supabase.com/dashboard), then copy its project URL and publishable key from the Connect panel.

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Restart Vite after changing environment variables.

`src/lib/supabase.ts` exports `getSupabase()` for future backend calls. It initializes on demand, so the placeholder page works without credentials. Only use a publishable key in the frontend; `VITE_` values are included in the browser bundle. Never put a database password or Supabase secret/service-role key there.

The `supabase/` directory contains CLI configuration for future database development. To link a hosted project:

```sh
npm run supabase -- login
npm run supabase -- link --project-ref YOUR_PROJECT_REF
```

For an optional local Supabase PostgreSQL environment, install and run Docker, then use `npm run supabase -- start`. Stop it with `npm run supabase -- stop`. Docker is not needed to use a hosted project. No application tables or migrations are included yet.

References: [Vite setup](https://vite.dev/guide/), [Supabase React setup](https://supabase.com/docs/guides/getting-started/quickstarts/reactjs), [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
