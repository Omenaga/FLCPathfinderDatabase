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

In `drum_corps`, the instrument in a row applies to every year in its `years` array. Keep one row per `(pathfinder_id, drum_played)` and add further years to that row for the same instrument.

**Implemented PBE/TLT change:** PBE now has one row per Pathfinder with a required `history jsonb` array of `{ "year": "YYYY-YYYY", "books": ["Book"] }` objects. Each year appears once and has its own book array. The latest migration is `20260911050000_pbe_year_history.sql`; it replaces PBE's separate `years` and `bible_books` columns and consolidates existing rows without inventing missing details.

TLT now also uses one row per Pathfinder with a required `history jsonb` array, pairing each calendar `year` with an `operations` array. Years are integers from 2017 through the database's current year (2026 today); the upper limit advances automatically. Any valid operation may be paired with any allowed year, and multiple different operations may be recorded in one year. Empty book/operation arrays preserve participation with details not yet recorded. Implemented in `20260911060000_tlt_year_history.sql`.

PBE enforces a unique `pathfinder_id` and unique years within `history`. TLT likewise enforces a unique `pathfinder_id` and unique years within `history`. Array ordering does not determine uniqueness or meaning. Historical scalar values were preserved with their recorded member/year associations.

For example, a member who played Snare in 2024-2025 and Bass in 2025-2026 has two `drum_corps` rows:

| `pathfinder_id` | `years` | `drum_played` |
|-----------------|---------|---------------|
| 1 | `["2024-2025"]` | Snare |
| 1 | `["2025-2026"]` | Bass |

If the same instrument was played in both years, one drum row can contain both years. PBE pairs each year with books inside one history row. TLT pairs each calendar year with its operations inside one history row.

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
Tracks all PBE years and their linked Bible books in **one row per Pathfinder**.

| Column | Type | Description / Example |
|---|---|---|
| `id` | Integer | Generated primary key |
| `pathfinder_id` | Integer | Unique FK to `pathfinders.id`; one PBE row per member |
| `history` | JSONB | Required nonempty array of year/books objects; see below |

```json
[
  { "year": "2013-2014", "books": ["2 Samuel"] },
  { "year": "2014-2015", "books": ["Matthew"] }
]
```

Each object must contain exactly `year` and `books`. Years cannot repeat. Books must be separate strings, not one comma-separated string, and must match that specific year's `pbe_year_books` entries. An empty `books` array is allowed when details are unknown. To add another year, extend the same row's `history` array.

### 7. `tlt` (Teaching Leadership Training)
Tracks all TLT calendar years and linked operations in **one row per Pathfinder**.
See [TLT Operation Options](#tlt-operation-options) for valid operations.

| Column | Type | Description / Example |
|---|---|---|
| `id` | Integer | Generated primary key |
| `pathfinder_id` | Integer | Unique FK to `pathfinders.id` |
| `history` | JSONB | Required nonempty array of year/operations objects |

```json
[
  { "year": 2017, "operations": ["Teaching", "Records"] },
  { "year": 2026, "operations": ["Administrative", "Activity", "Counseling"] }
]
```

Each object contains exactly `year` and `operations`. Calendar years must be JSON integers, not quoted strings or school-year ranges, from 2017 through the current year. Each year appears once. Any combination of valid operations is allowed for any year, including repeating an operation in different years. Operations must be unique within each year's array; `[]` means details are not yet recorded. Extend the same row's `history` to add years.

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

### Bible Book Options

**Implemented year-linked catalog: `public.pbe_year_books`.** The following school-year/book assignments were supplied by the user. These are allowed combinations, not one global book list. Preserve the names and chapter qualifications as written.

| School year | Allowed Bible books |
|---|---|
| `2011-2012` | 1 Samuel, Mark |
| `2012-2013` | Acts, 1 Thessalonians, 2 Thessalonians |
| `2013-2014` | 2 Samuel |
| `2014-2015` | Matthew |
| `2015-2016` | Exodus |
| `2016-2017` | Galatians, Ephesians, Philippians, Colossians, 1 Timothy, 2 Timothy |
| `2017-2018` | Daniel, Esther |
| `2018-2019` | Luke |
| `2019-2020` | Ezra, Nehemiah, Hosea, Amos, Jonah, Micah |
| `2020-2021` | Hebrews, James, 1 Peter, 2 Peter |
| `2021-2022` | 1 Kings, Ruth |
| `2022-2023` | John |
| `2023-2024` | Joshua, Judges |
| `2024-2025` | Romans, 1 Corinthians, 2 Corinthians |
| `2025-2026` | Isaiah (Chapters 1–33) |
| `2026-2027` | Mark, 1 Peter, 2 Peter, 1 John, 2 John, 3 John |

#### PBE year/book validation

- Each book in a `history` entry must be allowed for that entry's `year`. For `2021-2022`, only `1 Kings` and `Ruth` are allowed; either or both may be recorded. John belongs to `2022-2023`.
- Different entries in the same row can have different book sets. The year/book relationship is explicit and does not depend on matching positions in separate arrays.
- Years missing from the catalog are unconfigured. Their `books` arrays must remain empty until an administrator configures allowed books.
- Future entry controls should offer only the selected year's allowed books. The database validates every year/book pair on insert/update.
- Reference table: `pbe_year_books(school_year text, book_name text)`, with composite primary key `(school_year, book_name)`, populated from the mapping above. A trigger validates JSON entries against it.
- Catalog edits cannot remove or rename year/book pairs used in saved history.

### TLT Operation Options
Allowed string entries in each `tlt.history` object's `operations` JSON array. Entries must be unique; use these exact values:

1. Administrative
2. Outreach
3. Teaching
4. Activity
5. Records
6. Counseling

### Honor Evaluation Names by Year

**To be filled in by the user.** List the allowed evaluation names for each Red Zone calendar year below. These are integer event years (e.g. `2022`), not PBE school-year strings. Add or remove year rows as needed. TBD means not yet configured; it is not an allowed name.

| Event year | Allowed Honor Evaluation names |
|---|---|
| 2010 | TBD |
| 2011 | TBD |
| 2012 | TBD |
| 2013 | TBD |
| 2014 | TBD |
| 2015 | TBD |
| 2016 | TBD |
| 2017 | TBD |
| 2018 | TBD |
| 2019 | TBD |
| 2020 | TBD |
| 2021 | TBD |
| 2022 | TBD |
| 2023 | TBD |
| 2024 | TBD |
| 2025 | TBD |
| 2026 | TBD |

### Bible Event Names by Year

**To be filled in by the user.** List the allowed Bible Event names for each Red Zone calendar year. This catalog is independent of PBE Bible books and Honor Evaluation names. Add or remove year rows as needed. TBD is a placeholder, not an allowed name.

| Event year | Allowed Bible Event names |
|---|---|
| 2010 | TBD |
| 2011 | TBD |
| 2012 | TBD |
| 2013 | TBD |
| 2014 | TBD |
| 2015 | TBD |
| 2016 | TBD |
| 2017 | TBD |
| 2018 | TBD |
| 2019 | TBD |
| 2020 | TBD |
| 2021 | TBD |
| 2022 | TBD |
| 2023 | TBD |
| 2024 | TBD |
| 2025 | TBD |
| 2026 | TBD |

#### Named Red Zone event validation

- Each `red_zone_honor_evaluations` result must use a `(year, name)` pair from the Honor Evaluation catalog; each `red_zone_bible_events` result must use a pair from the Bible Event catalog. A name allowed in one year is not automatically allowed in another.
- Proposed reference tables: `honor_evaluation_options(year integer, name text)` and `bible_event_options(year integer, name text)`, each with composite primary key `(year, name)`. Each result table will reference its matching catalog with a composite foreign key on `(year, name)`.
- Keep existing unique `(pathfinder_id, year, name)` constraints. Placement remains attached to that result row; catalogs describe available events, not a member's participation or outcome.
- Future forms filter names by the chosen event year. Unconfigured years must not silently accept arbitrary names or the literal TBD. Changing the year requires revalidating the name.
- Before enabling these constraints, complete the catalogs for existing results and review any unmatched records. Preserve history; do not delete records to make a constraint pass. Referenced catalog pairs cannot be removed or changed while results still depend on them.
- Honor Evaluation and Bible Event reference tables and constraints remain planned only. PBE validation is implemented separately as described above.

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

### Proposed past-data profile overlay

Design only: the implemented profile overlay continues to show only WIP. The following layout is for future implementation and does not change database tables.

Clicking a member's name opens the profile over the search results. Preserve filters, results, and pagination while opening and closing it. Display content in this order:

1. **Name and Status on one line.** Show the member's name and effective status: New, Returning, Graduated, or Unregistered. Use the same status rules as search results, including persistent graduation. Allow wrapping on narrow screens.
2. **Years Active on the next line.** List the recorded school years, without duplicates and in chronological order. If none are recorded, show No years recorded.
3. **Levels Earned on the next line.** List all earned levels in class progression order. Format Advanced achievements as `Friend (Advanced)`. If none are recorded, show No levels recorded. Do not infer achievements from current class enrollment.
4. **Extracurricular history.** Give each activity with detail records its own full section, in the order Drill, Drum, PBE, TLT. Omit an activity's section when it has no detail rows, even if the cumulative participation array lists its name. Keep each value paired with its recorded years as described below; TLT uses calendar years.
5. **Red Zone Events.** Use a compact, separate area for each event with recorded results. Omit empty event areas. Keep each result's year, placement, and optional event/evaluation name together. Arrange these smaller areas in a responsive grid; do not combine different events into one undifferentiated list.
6. **Honors.** Place an Honors area last with a View Honors button that opens a separate pop-up. That pop-up should initially display only WIP and a Close control, without listing honors or fetching their data. This leaves room for a large honors collection later.

#### Extracurricular sections

| Profile section | Historical source | Display |
|---|---|---|
| Drill | `drill` | All recorded participation school years |
| Drum | `drum_corps` | School year and instrument for each participation record; expand each row's year array while keeping its instrument attached |
| PBE | `pbe` | Each `history` entry's `year` and `books`, kept together |
| TLT | `tlt` | Each `history` entry's calendar `year` and `operations`, kept together |

Drum is the profile section label; the existing stored activity name remains `Drums`. No table or option renaming is required. Sort activity histories by school year, retaining all associated details.

#### Red Zone mini sections

Each existing Red Zone event maps to its own mini section: Drill Performance, Drum Performance, Honor Evaluations, Bible Events, Knots Relay, Tents, Jump Rope, Archery, Lashing, and Burning Twine. Display only sections with actual detail rows. Within each section, show results newest first. Honor Evaluations and Bible Events also show each result's `name` so multiple results in the same year remain distinguishable.

#### Overlay behavior

Both pop-ups need a visible Close control, Escape-to-close behavior, an accessible title, focus containment, and scrollable mobile layouts. Opening Honors preserves the underlying profile and its scroll position. Closing Honors returns focus to View Honors and leaves the profile open; Escape closes only the topmost pop-up. Closing the profile returns focus to the member name in search results.

When the full profile is implemented, include loading/error/retry states and prevent stale requests from displaying the wrong member's history. Keep member IDs internal. Current grade, current class, current activities, and registration archive snapshots are not additional rows in this past-data layout; the current-data results and future rollover design remain separate.

### Future annual rollover (not implemented)

When staff starts a new club year, archive the previous current registration before replacing it. Existing historical tables cannot preserve annual status, grade, or class assignment, so rollover needs an additional annual snapshot store rather than discarding unmatched fields.

Proposed future `registration_history`: one row per `(pathfinder_id, school_year)`, with an internal ID, foreign key, year, `snapshot jsonb`, `snapshot_version`, and `archived_at`. The snapshot preserves the outgoing `current_data` values plus the member name at archival time. This is a future table, not part of the implemented 17-table schema.

Rollover should:

1. Select and validate the outgoing/incoming club years explicitly.
2. Archive outgoing rows with their status, grade, class, activities, and internal school year.
3. Merge confirmed active years and participation into existing historical structures without duplicates. Merge further years into existing member/instrument rows. For PBE, merge books into the matching year entry in the member's single `history` row. For TLT, record operations under the calendar year they were completed, merging into that year's entry without duplicates. Do not automatically convert a school-year range to a calendar year. Preserve event-year/placement pairs and honor records.
4. Transfer only verified achievements/results. A current class is not an earned level, and a blank result is not a Participation award. Current-year detailed results can already reside in the year-specific history tables; do not reinsert them blindly.
5. Complete the archive and related updates in one transaction before clearing/replacing the current rows. Repeating the operation must not duplicate history or overwrite an existing archive silently.
6. Create new current rows from the new year's registrations. Keep historical members searchable even when they do not return. Do not automatically carry forward grade, class, participation, or status; use the new registration to establish these values.

The current-data table, search view, and WIP overlay are implemented. No scheduled job, rollover action, archive table, import integration, or full profile content is implemented.

### Graduation and missing current registration

The `20260911020000_registration_status.sql` migration removes Left as an accepted status. Missing current data represents inactivity; Unregistered is a derived display label, not a stored status. A permanent `pathfinders.graduated` flag takes precedence across seasons and after removal of current data. Historical participation remains searchable. To correct a graduation marker, staff must explicitly update the permanent flag and any current graduated status; a new registration never clears it automatically. Legacy Left rows, if present in another database, must be archived before removal; the migration refuses to discard them silently.

Status is searchable through `member_search.status`: New, Returning, Graduated, or Unregistered. Unregistered is derived from the absence of current-year data; graduation takes precedence. Existing current rows with an unknown status remain unclassified rather than being assumed inactive. The Status filter combines with historical filters using AND.

Active year, Level earned, Extracurricular, and Red Zone event support multiple selections with searchable dropdowns. Type to narrow options and press Enter to add; selected chips can be removed. Every selected value must match (AND), including across filter categories. Each selected calendar year matches either adjacent school year. Year choices run from 2010 through the current calendar year. The Level earned dropdown contains regular and Advanced options side by side (Friend, Friend (Advanced), Companion, Companion (Advanced), and so on). Each selection matches its exact Advanced status. Selected chips sit below the inputs in fixed-height scrollable areas to preserve alignment. Status remains a single-select filter.

### PBE/TLT implementation and manual entry

PBE uses one row per member with a required `history` array. In Supabase Table Editor, paste JSON like the example in the PBE table section. Each year has its own `books` array. TLT also uses one `history` row, with calendar years paired with `operations` (e.g. `{"year":2026,"operations":["Teaching","Records"]}`). The known six TLT operations are enforced, and PBE books must match their associated year in `pbe_year_books`.

The original array migration preserved member/year/detail associations, regenerating internal PBE/TLT row IDs. The subsequent PBE history migration consolidates rows per member and retains the smallest existing PBE row ID. Missing book details remain empty arrays; catalog books are never automatically assigned as participation. Permanent member IDs and other histories are unchanged. Catalog modifications are administrator-only and cannot invalidate saved history.

The TLT calendar-year migration was applied while the live TLT table was empty. It stops without changing data if legacy school-year TLT rows exist, because assigning a completion calendar year requires staff input. TLT history validation permits 2017 through the current database year, without a year-specific operation catalog.
