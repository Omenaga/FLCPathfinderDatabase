# Reading and maintaining the application

Start with this guide, then open the files in the order below. The README explains how to run the application; this guide explains how its code fits together.

For the file-by-file and function-by-function walkthrough, read [How the FLC Pathfinder application works](code-reference.md). It includes workflow explanations, a complete migration map, configuration responsibilities, and guidance on where to make changes. The reusable [explain-codebase skill](../skills/explain-codebase/SKILL.md) describes how to maintain this documentation.

## A few terms

- **Component:** a function that describes a piece of the screen. React updates the screen when its state changes.
- **State:** values a component remembers, such as selected filters or an unsaved form.
- **Props:** values or callbacks a parent component passes to a child.
- **Effect:** work tied to a component's lifecycle, such as loading data. Its cleanup cancels work or removes listeners.
- **Supabase:** the service providing sign-in and the PostgreSQL database.
- **RPC:** a call to a database function. This application uses these functions for coordinated writes and validation.
- **Migration:** a numbered SQL file that changes the database. Apply these files in filename order.
- **RLS:** row-level security, the database policies that decide which records an account may access.

## Follow a request through the application

1. `index.html` provides the root element. `src/main.tsx` mounts React and loads `src/index.css`.
2. `src/App.tsx` checks configuration and sign-in state. Signed-in staff see the search screen and addition buttons.
3. `src/features/search/Search.tsx` separates filters being edited from filters submitted to the database. It also supports selecting recipients for bulk additions.
4. `src/lib/pathfinders.ts` builds search expressions, fetches a page of members, and assembles profile history. `src/lib/supabase.ts` shares one configured client.
5. `src/features/profile/ProfileOverlay.tsx` opens a member's history. Honors load separately, and notes are read-only here.
6. `src/features/profile/EditProfile.tsx` loads the editable snapshot, keeps a local draft, and requests confirmation before saving. `profileChanges.ts` converts snapshots into the visible receipt.

After a successful write, callbacks notify the parent screen to reload data. Search filters survive these refreshes.

## The three write workflows

| Workflow              | Frontend          | Database function   | Important behavior                                                                           |
| --------------------- | ----------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| Create a person       | `AddRecords.tsx`  | `add_member_record` | Creates the person and registration together; confirmation expires after five seconds.       |
| Add history to people | `AddToRecord.tsx` | `add_to_records`    | Reviews recipients, merges history, and reports each person's outcome separately.            |
| Edit a profile        | `EditProfile.tsx` | `update_profile`    | Sends the original and reviewed snapshots; rejects stale edits and saves changes atomically. |

An atomic save either completes as a whole or leaves the prior data intact. Bulk additions deliberately allow one recipient to fail while others succeed. Preserve that distinction when changing save handling.

## Shared controls and display helpers

`Modal.tsx` uses the browser's native dialog, locks background scrolling, and restores focus. `MultiSelect.tsx` handles typing, keyboard navigation, grouped options, and exclusive choices; its behavior is shared by many screens. `Select.tsx` handles simple single-value filters. `HonorPicker.tsx` searches the honor catalog after a short typing delay.

`HistoryRecords.tsx` sorts history without changing the caller's array and puts unknown years last. `format.ts` supplies shared labels; `errors.ts` extracts an error message from an unknown thrown value.

## Data rules worth understanding first

- A club year is a string such as `2023-24`. Unknown history years are `null`, displayed as **Unknown**. Never invent a missing year.
- Choices within a search category match any selected choice; separate selected categories must all match. Years constrain the selected history categories. Detail and year must refer to the same history instance.
- Current registration describes the present; history records describe the past. Current member status does not determine which historical activities may be displayed.
- PBE means Pathfinder Bible Experience. Bible books come from the year catalog, while placements progress through Area, State, Union, and Divisional regions.
- UI validation helps users, but database functions and policies enforce the actual write and access rules.
- Abort controllers cancel obsolete reads. Save guards prevent repeated clicks while a write is in progress. Keep both when refactoring asynchronous code.

See [database-schema.md](database-schema.md) for table details and [project-context.md](project-context.md) for ministry terminology.

## Reading the database history

The migrations are a sequence, not a collection of interchangeable schema files. A function may be replaced several times: earlier versions are still necessary to reproduce upgrades and migrate old data. Search for its name in `supabase/migrations`, then read the latest definition alongside any later alterations. `tests/revision.test.mjs` replays the entire sequence with legacy records.

The initial migration creates the original tables and security rules. Later migrations introduce current registration, detailed year searches, revised member history, additions, and profile editing. The current sequence ends with `20260916040000_preserve_current_registration.sql`.

Do not rewrite applied migrations for formatting or remove superseded definitions. Add a new migration for database changes. `supabase/admin/grant-initial-staff.sql` is a retired explanatory script; account provisioning now uses Supabase Auth. `supabase/seed.sql` intentionally contains no member data.

`src/lib/database.types.ts` is generated from the database. Regenerate it using the README command; manual explanations belong in this guide or the handwritten data-access code. Formatting excludes generated types and applied migrations to keep them reproducible.

## Formatting and verification

Run `npm run format` to format maintained source, tests, configuration, and Markdown. Run `npm run format:check` to check without writing. Prettier uses two spaces, single quotes in JavaScript/TypeScript, and no optional statement semicolons. SQL migration history is intentionally excluded, and Prettier does not format TOML or standalone SQL files.

Before finishing a change, run:

```sh
npm run format:check
npm run lint
npm test
npm run build
npm run test:ui
```

Database tests run in PGlite, a local PostgreSQL engine. Browser tests launch Edge and mock Supabase responses. Neither suite modifies the hosted database. Browser tests cover interaction behavior; database tests cover actual SQL validation and permissions.

Comments explain purpose, data rules, and surprising decisions. Update them alongside behavior, and avoid narrating obvious assignments. Keep changes small enough to review; remove code only after checking callers, tests, configuration, and database dependencies. Retain original artwork unless its retirement is intentional.
