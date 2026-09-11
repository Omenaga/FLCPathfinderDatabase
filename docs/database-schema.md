# FLC Pathfinder Database Schema

This document describes the structure for the FLC Pathfinder member tracking database. The initial implementation is in [`20260908000000_pathfinder_database.sql`](../supabase/migrations/20260908000000_pathfinder_database.sql). JSON columns use PostgreSQL `jsonb`.

**Status:** Tables 1-18 are implemented, including `current_data` and the RLS-protected `member_search` view. Search results show current data while existing historical filters remain available. Clicking a name opens a modal containing only WIP; full profile contents and annual rollover remain future work.

---

## Core Tables

### 1. `pathfinders` (Members)
Holds one row per individual Pathfinder.

| Column          | Type    | Description / Example                             |
|-----------------|---------|---------------------------------------------------|
| `id`            | Integer | Primary key (auto-increment)                      |
| `name`          | String  | Full name of the Pathfinder                       |
| `years_active`  | JSON    | Array of active school years — e.g. `["2024-2025", "2025-2026"]` |
| `levels`        | JSON    | Array of earned level objects with `name` and `advanced` — see [Levels Options](#levels-options) |
| `extracurriculars` | JSON | Array of activity names — e.g. `["Drill", "Drums", "PBE", "TLT"]`; see [Extracurricular Names Options](#extracurricular-names-options) for linked detail tables |
| `red_zone_participation` | JSON | Array of events participated in — e.g. `["Drill Performance", "Archery"]`; see [Red Zone Participation Links](#red-zone-participation-links) for linked event tables |
| `graduated` | Boolean | Permanent graduation marker, default false. Preserves Graduated status without a current registration. |
| `created_at` | Timestamp | Creation time, automatically set by the database |
| `updated_at` | Timestamp | Most recent member-row update time, maintained by a database trigger |

The extracurricular and Red Zone event arrays default to `[]` and contain unique values. Extracurricular membership is stored directly in `pathfinders.extracurriculars`, replacing the activity master list and membership junction table. Red Zone participation is stored directly in `pathfinders.red_zone_participation`, replacing the separate participation table.

---

## Achievement & Activity Tables

### 2. `honors` (Honor Master List)
Lookup table for all possible honors.

| Column  | Type    | Description                                   |
|---------|---------|-----------------------------------------------|
| `id`    | Integer | Primary key                                   |
| `name`  | String  | Honor name — e.g. "Worship", "Heritage"         |

### 3. `honors_earned` (Earned Honors)
Records when a Pathfinder earned an honor.

| Column            | Type    | Description / Example                          |
|-------------------|---------|------------------------------------------------|
| `id`              | Integer | Primary key                                    |
| `pathfinder_id`   | Integer | FK → `pathfinders.id`                          |
| `honor_id`        | Integer | FK → `honors.id`                               |
| `year_earned`     | Integer | Year honor was earned — e.g. 2013, 2024        |

---

## Sub-Activity Tracking Tables

Each table links to the member through `pathfinder_id`. Its activity name must appear in that member's `extracurriculars` array. Searching a member's activities resolves each name using [Extracurricular Names Options](#extracurricular-names-options), then returns all matching detail rows for that member, including their years and any associated instrument, Bible book, or TLT operation.

In `drum_corps`, `pbe`, and `tlt`, the string value in a row applies to **every year in that same row's `years` array**. Store another row for a different string value; do not combine years with unrelated details. Multiple values in the same year are represented by separate rows whose year arrays include that year. Require nonempty arrays of unique school years and prevent duplicate member/year/string combinations across rows.

The implementation groups all years for the same member/string value in one row, enforced by unique `(pathfinder_id, drum_played)`, `(pathfinder_id, bible_book)`, and `(pathfinder_id, tlt_operation)` constraints. Add further years to the existing row when the string is unchanged. This prevents duplicate member/year/string combinations without parallel arrays.

For example, a member who played Snare in 2024-2025 and Bass in 2025-2026 has two `drum_corps` rows:

| `pathfinder_id` | `years` | `drum_played` |
|-----------------|---------|---------------|
| 1 | `["2024-2025"]` | Snare |
| 1 | `["2025-2026"]` | Bass |

If the same instrument was played in both years, one row can contain both years. The same rule pairs `bible_book` and `tlt_operation` with their respective year arrays.

### 4. `drill` (Drill Participation)
Tracks years of Drill participation, with one row per Pathfinder.

| Column | Type | Description / Example |
|--------|------|-----------------------|
| `pathfinder_id` | Integer | Primary key and FK → `pathfinders.id` |
| `years` | JSON | Array of school years — e.g. `["2024-2025", "2025-2026"]` |

### 5. `drum_corps` (Drum Participation)
Tracks years and instrument played in drum corps.  
See [Drums Played Options](#drums-played-options) for valid instruments.

| Column          | Type    | Description / Example                              |
|-----------------|---------|----------------------------------------------------|
| `id`            | Integer | Primary key                                        |
| `pathfinder_id` | Integer | FK → `pathfinders.id`                              |
| `years`         | JSON    | Array of school years — e.g. `["2024-2025", "2025-2026"]` |
| `drum_played`   | String  | Instrument for every year in this row — see [Drums Played Options](#drums-played-options)                     |

### 6. `pbe` (Pathfinder Bible Experience)
Tracks PBE years and linked Bible books.

| Column          | Type    | Description / Example                              |
|-----------------|---------|----------------------------------------------------|
| `id`            | Integer | Primary key                                        |
| `pathfinder_id` | Integer | FK → `pathfinders.id`                              |
| `years`         | JSON    | Array of school years — e.g. `["2024-2025", "2025-2026"]` |
| `bible_book`    | String  | Bible book for every year in this row — e.g. "Exodus", "Luke"          |

### 7. `tlt` (Teaching Leadership Training)
Tracks TLT years and linked operations.
See [TLT Operation Options](#tlt-operation-options) for valid operations.

| Column          | Type    | Description / Example                              |
|-----------------|---------|----------------------------------------------------|
| `id`            | Integer | Primary key                                        |
| `pathfinder_id` | Integer | FK → `pathfinders.id`                              |
| `years`         | JSON    | Array of school years — e.g. `["2024-2025", "2025-2026"]` |
| `tlt_operation`         | String  | TLT operation for every year in this row — see [TLT Operation Options](#tlt-operation-options)                      |

---

## Special Event Tables

Event names are stored in the core `pathfinders.red_zone_participation` array. Each name maps to a detail table through [Red Zone Participation Links](#red-zone-participation-links). Searching a member's Red Zone events returns the matching rows by `pathfinder_id`, including each year, its placement, and the evaluation/event name where applicable.

Each row stores one result: its `placement` belongs directly to its `year` (and `name`, where present). Store results from different years in separate rows so placements remain paired with the correct year. For example, Archery in 2024 with `1st Place` and Archery in 2025 with `2nd Place` are two rows for the same member. Use unique `(pathfinder_id, year)` pairs for unnamed events and unique `(pathfinder_id, year, name)` combinations for Honor Evaluations and Bible Events.

### 8. `red_zone_drill_performance`
Tracks placement results for Drill at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement for this row's year — see [Placement Options](#placement-options) |

### 9. `red_zone_drum_performance`
Tracks placement results for Drums at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement for this row's year — see [Placement Options](#placement-options) |

### 10. `red_zone_honor_evaluations`
Tracks placement results for Honor Evaluations (by name) at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `name`         | String  | Name of evaluation — e.g. "Junior", "Senior" |
| `placement`    | String  | Placement for this row's year — see [Placement Options](#placement-options) |

### 11. `red_zone_bible_events`
Tracks placement results for Bible Events (by name) at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `name`         | String  | Name of event — e.g. "Bible Ball", "Bible Quiz" |
| `placement`    | String  | Placement for this row's year — see [Placement Options](#placement-options) |

### 12. `red_zone_knots`
Tracks placement results for Knots Relay at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement for this row's year — see [Placement Options](#placement-options) |

### 13. `red_zone_tents`
Tracks placement results for Tents at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement for this row's year — see [Placement Options](#placement-options) |

### 14. `red_zone_jump_rope`
Tracks placement results for Jump Rope at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement for this row's year — see [Placement Options](#placement-options) |

### 15. `red_zone_archery`
Tracks placement results for Archery at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement for this row's year — see [Placement Options](#placement-options) |

### 16. `red_zone_lashing`
Tracks placement results for Lashing at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement for this row's year — see [Placement Options](#placement-options) |

### 17. `red_zone_burning_twine`
Tracks placement results for Burning Twine at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement for this row's year — see [Placement Options](#placement-options) |

---

## Column Option Definitions

### Levels Options
The `levels` column is a JSON array, allowing a member to earn any or all of the levels below. Each entry has a `name` from this list and an `advanced` boolean indicating whether that particular level was earned as Advanced. Advanced is a status of an earned level, not a separate level name.

Example: `[{"name": "Friend", "advanced": true}, {"name": "Companion", "advanced": false}]` records Advanced Friend and regular Companion. Default the array to `[]`; keep one entry per level name and update its `advanced` status when Advanced is earned.

Valid level names:

1. Friend
2. Companion
3. Explorer
4. Ranger
5. Voyager
6. Guide
7. Pioneer
8. Navigator

### Extracurricular Names Options
Valid values for the `extracurriculars` JSON array in `pathfinders`.
Each maps to its respective detail table through `pathfinder_id`:

1. **Drill** → [`drill`](#4-drill-drill-participation)
2. **Drums** → [`drum_corps`](#5-drum_corps-drum-participation)
3. **PBE** → [`pbe`](#6-pbe-pathfinder-bible-experience)
4. **TLT** → [`tlt`](#7-tlt-teaching-leadership-training)

### Drums Played Options
Valid values for the `drum_played` column in the `drum_corps` table.

1. Snare
2. Quad
3. Bass
4. Tenor
5. Cymbol

### TLT Operation Options
Valid values for the `tlt_operation` column in the `tlt` table.

1. Administrative
2. Outreach
3. Teaching
4. Activity
5. Records
6. Counseling

### Placement Options
Valid values for the `placement` column in every Special Event table. The placement always describes the year in the same row.

1. 1st Place
2. 2nd Place
3. 3rd Place
4. Participation

### Red Zone Participation Links
The `pathfinders.red_zone_participation` JSON array contains the event names the member participated in, using these exact options and table mappings:

| Event name | Detail table |
|------------|--------------|
| Drill Performance | [`red_zone_drill_performance`](#8-red_zone_drill_performance) |
| Drum Performance | [`red_zone_drum_performance`](#9-red_zone_drum_performance) |
| Honor Evaluations | [`red_zone_honor_evaluations`](#10-red_zone_honor_evaluations) |
| Bible Events | [`red_zone_bible_events`](#11-red_zone_bible_events) |
| Knots Relay | [`red_zone_knots`](#12-red_zone_knots) |
| Tents | [`red_zone_tents`](#13-red_zone_tents) |
| Jump Rope | [`red_zone_jump_rope`](#14-red_zone_jump_rope) |
| Archery | [`red_zone_archery`](#15-red_zone_archery) |
| Lashing | [`red_zone_lashing`](#16-red_zone_lashing) |
| Burning Twine | [`red_zone_burning_twine`](#17-red_zone_burning_twine) |

All available options are:

```json
["Drill Performance", "Drum Performance", "Honor Evaluations", "Bible Events", "Knots Relay", "Tents", "Jump Rope", "Archery", "Lashing", "Burning Twine"]
```

Store only the events that the member actually participated in; use `[]` when there are none. Every event detail record links to `pathfinders.id` through `pathfinder_id`, and its mapped event name must appear in that member's array. Years and placements are stored together in the detail rows.

Keep extracurricular and Red Zone arrays consistent with their detail records when adding, updating, or removing participation. JSON names are logical links resolved using the mappings above, rather than ordinary foreign keys. Enforce name membership through application validation or database triggers; the detail tables' `pathfinder_id` columns remain database foreign keys.

## Implementation and access

The database validates JSON option values, unique array entries, consecutive school years, and level objects. Participation triggers reject a detail row unless its activity/event appears in the core array, and reject removal of a core name while matching details remain. Core participation can exist before details are recorded. Add the core name first, then the detail records.

All 17 application tables have row-level security. Every authenticated Supabase Auth account is trusted staff and may read, insert, and update through the API. Browser deletion remains disabled. There is no separate approval step. Administrators create accounts in Supabase Auth, and public signup must remain disabled.

The September 11 migration makes `current_staff_role()` return `editor` for any authenticated user identity, preserving existing policy and older-client compatibility. The legacy private `staff_access` table is retained as historical data only; it no longer controls access. See the [README](../README.md#staff-accounts) for onboarding.


## Current Data

Implemented September 11, 2026 in `20260911010000_current_data.sql`. The overlay is a WIP shell; profile data and rollover are deferred.

### Purpose and relationship to existing data

Add an application table named `current_data`, displayed as **Current Data**, for each Pathfinder's registration and enrollment in the current club year. Keep `pathfinders` as the permanent person record; its ID remains the internal link for current data and historical achievements. A returning member keeps the same ID across years. Names alone are not sufficient for matching imported registrations to existing people.

There is at most one current row per member. A member with only historical records may have no current row. The current club year is an explicitly selected ministry season, such as `2026-2027`; do not infer it from January 1 or automatically treat the latest historical year as current.

The existing `pathfinders` arrays and detail tables remain cumulative records. Do not copy their lifetime achievements into current-year fields or erase them when registration changes.

### Registration source and field confidence

Reviewed the [Forest Lake 2026-2027 registration page](https://forestlake.churchcenter.com/registrations/events/3638481) on September 11, 2026. Its public description confirms new/returning registration categories, grade-linked classes, guardian legal names, optional club teams and event interests, a separate notarized medical-consent form, and uniform purchases. Interest does not establish participation.

The full registration questionnaire could not be retrieved through the public Register link. The fields below are a proposed app model, not a verified reproduction of every registration question. Obtain the actual questionnaire or export column headings before finalizing imports. No registration was submitted and no private registration data was collected.

### 18. `current_data`

| Column | PostgreSQL type | Purpose and proposed validation |
|---|---|---|
| `pathfinder_id` | `integer` | Primary key and foreign key to `pathfinders.id`; internal only. One current row per person. |
| `school_year` | `text` | Required consecutive school-year string, e.g. `2026-2027`; retained internally for current-year selection and rollover, not displayed in current-data results or the current profile summary. Use the existing school-year validation semantics. |
| `status` | `text`, nullable | `new`, `returning`, or `graduated`. Marking a current row Graduated also sets `pathfinders.graduated = true`. No current-year row means **Unregistered**, unless the permanent graduation marker is set. Null on an existing current row means not yet recorded. |
| `grade` | `smallint`, nullable | Current school grade; accepts 1-12 to accommodate age-based exceptions. Typical club enrollment is grades 5-12. |
| `class_level` | `text`, nullable | Current enrolled class: Friend, Companion, Explorer, Ranger, Voyager, Guide, Pioneer, or Navigator. Does not indicate an earned level. |
| `current_activities` | `jsonb` | Unique array of Drill, Drums, PBE, and/or TLT; default `[]`. Confirmed current-year participation, entered/verified by staff. |
| `created_at` | `timestamptz` | Database creation timestamp. |
| `updated_at` | `timestamptz` | Database-maintained timestamp for changes to this current row. |

Display the member's name through the `pathfinders` relationship rather than storing a second editable name in `current_data`. Derive E-Tracker/Varsity from the assigned class if displayed. Do not infer completed Advanced status from grade or class enrollment.

Optional source-specific fields such as birth date, school, address, emergency contact, shirt size, and fee/payment status are not finalized. Confirm their actual registration definitions and operational need before adding columns. Financial transactions, medical documents, and adult screening records are not part of this proposed table.

### Constraints and access

- `pathfinder_id` must reference an existing member and must never appear in the visible search results or profile.
- Unknown scalar values remain null; never invent a grade, status, or participation record to fill gaps.
- JSON arrays must have valid shapes and unique allowed values.
- The search view combines current activities with historical participation without rewriting history. Existing detailed-history rows still require their activity in the cumulative member array. Annual merging is deferred to rollover.
- Retain row-level security for all proposed data. Follow the current app access model: authenticated staff may read, insert, and update; anonymous access and browser deletion remain disabled.
- `public.current_club_year()` explicitly returns `2026-2027`. The search view joins current data only for that season; change the function through a future migration when rollover is ready. No automatic date-based rollover occurs.

### Search results

Search should return one result per person, using `pathfinders` as the base and a left join to `current_data` for the selected club year. A current-data-only inner join would wrongly hide historical members.

The result table should show current information:

| Visible column | Source |
|---|---|
| Name | `pathfinders.name`; opens the profile overlay |
| Grade | `current_data.grade` |
| Current class | `current_data.class_level` |
| Status | Graduated if `pathfinders.graduated` is true; otherwise New/Returning from current data, or Unregistered when absent |
| Current activities | `current_data.current_activities` |

**Status-dependent display:** For members with no current registration or a Graduated status, show their name and Status, but do not display grade, current class, or current activities. In the shared results table, show **N/A** in the Grade, Current class, and Current activities cells for Unregistered or Graduated members. These members are no longer currently participating; do not present retained values as current enrollment. This is a display rule, not an instruction to delete stored data or historical participation.

The current club year is already known from the application context, so `school_year` is not a visible column. Show **Unregistered** for a historical member without a matching current row, unless `pathfinders.graduated` is true, in which case show **Graduated**, and use blank/unknown indicators for unrecorded values. Never label their last historical class or activity as current.

Keep all existing filters: name, active year, earned level/Advanced status, extracurricular, and Red Zone event. Historical filters continue to search cumulative records even though those details no longer appear in the result columns. Within each filter, match either relevant current or historical data where applicable; distinct filters still combine with AND. Keep counts and pagination at the person level so joins cannot duplicate members.

- **Active year:** `2014` matches `2013-2014` or `2014-2015` in historical active years or the current enrollment school year. New/Returning rows represent current enrollment. unregistered/graduated rows remain searchable but their presence alone must not establish activity in that school year; retain confirmed active years and participation recorded before departure or graduation.
- **Level earned:** searches completed levels only, never `class_level`. Display Advanced achievements as `Friend (Advanced)`.
- **Extracurricular:** searches confirmed current participation or cumulative participation.
- **Red Zone event:** searches recorded participation/results.
- Preserve the existing meaning of combined year/activity filters: a member must match both, but this does not imply that the activity took place during the searched year. A same-year participation filter would be a separate future feature.
- Honor and detailed history search can be expanded later; this proposal preserves existing filter capabilities rather than implying those extra filters already exist.

### Proposed member profile overlay

Clicking a name opens a modal profile over the existing results instead of the current inline detail panel. Preserve search filters, results, and pagination when opening or closing it.

Future profile contents (not rendered or fetched by the current WIP overlay):

1. Member name and current enrollment summary.
2. Status (New/Returning/unregistered/graduated). Show grade, current class, and confirmed current activities only when a current registration exists and the member is not Graduated; omit those fields entirely from the current profile summary for unregistered/graduated members. The current `school_year` stays internal; historical years remain visible in history sections.
3. Historical active years and earned levels.
4. Existing extracurricular history, with instrument/book/operation paired with the correct school years.
5. Existing Red Zone history, with each event year paired with its placement.
6. Honors earned and their years.
7. Archived registration snapshots when rollover is implemented.

The future modal should have a visible Close button, Escape-to-close behavior, focus containment, focus return to the clicked name, an accessible title, and a scrollable mobile layout. Include loading/error/retry states and prevent an older request from displaying the wrong person's profile. Member IDs remain internal.

### Future annual rollover (not implemented)

When staff starts a new club year, archive the previous current registration before replacing it. Existing historical tables cannot preserve annual status, grade, or class assignment, so rollover needs an additional annual snapshot store rather than discarding unmatched fields.

Proposed future `registration_history`: one row per `(pathfinder_id, school_year)`, with an internal ID, foreign key, year, `snapshot jsonb`, `snapshot_version`, and `archived_at`. The snapshot preserves the outgoing `current_data` values plus the member name at archival time. This is a future table, not part of the implemented 17-table schema.

Rollover should:

1. Select and validate the outgoing/incoming club years explicitly.
2. Archive outgoing rows with their status, grade, class, activities, and internal school year.
3. Merge confirmed active years and participation into existing historical structures without duplicates. Merge further years into existing member/instrument, member/book, and member/operation rows. Preserve event-year/placement pairs and honor records.
4. Transfer only verified achievements/results. A current class is not an earned level, and a blank result is not a Participation award. Current-year detailed results can already reside in the year-specific history tables; do not reinsert them blindly.
5. Complete the archive and related updates in one transaction before clearing/replacing the current rows. Repeating the operation must not duplicate history or overwrite an existing archive silently.
6. Create new current rows from the new year's registrations. Keep historical members searchable even when they do not return. Do not automatically carry forward grade, class, participation, or status; use the new registration to establish these values.

The current-data table, search view, and WIP overlay are implemented. No scheduled job, rollover action, archive table, import integration, or full profile content is implemented.

### Graduation and missing current registration

The `20260911020000_registration_status.sql` migration removes Left as an accepted status. Missing current data represents inactivity; Unregistered is a derived display label, not a stored status. A permanent `pathfinders.graduated` flag takes precedence across seasons and after removal of current data. Historical participation remains searchable. To correct a graduation marker, staff must explicitly update the permanent flag and any current graduated status; a new registration never clears it automatically. Legacy Left rows, if present in another database, must be archived before removal; the migration refuses to discard them silently.

Status is searchable through `member_search.status`: New, Returning, Graduated, or Unregistered. Unregistered is derived from the absence of current-year data; graduation takes precedence. Existing current rows with an unknown status remain unclassified rather than being assumed inactive. The Status filter combines with historical filters using AND.

Active year, Level earned, Extracurricular, and Red Zone event support multiple selections with searchable dropdowns. Type to narrow options and press Enter to add; selected chips can be removed. Every selected value must match (AND), including across filter categories. Each selected calendar year matches either adjacent school year. Year choices run from 2010 through the current calendar year. Level status applies to all selected earned levels. Status remains a single-select filter.
