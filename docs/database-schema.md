# FLC Pathfinder Database Schema

Implemented September 14, 2026. React/Vite uses Supabase PostgreSQL and Auth. All authenticated accounts remain trusted application users; person Status is participation information, not an authorization role. Anonymous access and browser deletion are denied by RLS/permissions.

## Person and current data

### `pathfinders`

One permanent row per person, including Pathfinder, Staff, Parent, and inactive people. IDs remain internal and are never name-based.

| Column | Type | Meaning |
|---|---|---|
| `id` | integer identity | Permanent primary key |
| `first_name` | text | Trimmed, 1-200 characters |
| `last_name` | text | Trimmed, up to 200 characters; blank allowed when unknown |
| `years_active` | jsonb | Unique Pathfinder participation ranges, e.g. `["2023-24"]` |
| `levels` | jsonb | Level/outcome/year entries described below |
| `birth_date` | date, nullable | Birthday; display MM/DD/YYYY without timezone conversion |
| `notes` | text, nullable | Multiline plain text; editable through Save Notes in the profile |
| `created_at`, `updated_at` | timestamptz | Creation and automatically updated modification time |

The old name, graduated, extracurriculars, and red_zone_participation columns are removed. Full display/search names are derived from first and last names. Historical participation comes from detail tables.

### `current_data`

At most one row per person. `current_club_year()` selects `2026-27`; this changes only through an intentional rollover, not automatically in January.

| Column | Type | Meaning |
|---|---|---|
| `pathfinder_id` | integer PK/FK | References the permanent person |
| `school_year` | text | Required `YYYY-YY` range; internal club-season selection |
| `status` | text | Pathfinder (`pathfinder`), Staff (`staff`), Parent (`parent`), Not Active (`not_active`); default Not Active |
| `current_title` | text, nullable | Single column for a Pathfinder class or Staff title |
| `current_activities` | jsonb | Unique array of Drill, Drums, PBE, TLT; confirmed current participation |
| `created_at`, `updated_at` | timestamptz | Maintained timestamps |

Grade is removed. For Pathfinder, current_title must be one of the eight level names. For Staff, it must come from `staff_titles`; this catalog starts empty pending the user's choices. Unknown titles remain null. Parent/Not Active must have null titles. Changing status requires a compatible title or clearing it. Current classes do not imply earned achievements.

### `staff_titles` and `staff_history`

`staff_titles(title text primary key)` holds allowed staff titles; authenticated users may read the catalog, and administrators configure it. Referenced titles cannot be removed in a way that invalidates saved current or historical data. No placeholder title is stored.

`staff_history` contains `id` (identity primary key), `pathfinder_id` (FK), `years` (nonempty unique range array), and nullable `title` (FK to staff_titles). One row per member/title, including at most one unknown-title row; group all that title's periods in `years`. Staff years are included in Years Active search.

## Year ranges and migration

All stored participation/achievement years use consecutive `YYYY-YY` ranges, e.g. `2012-13`, `2023-24`, `2026-27`. The four-digit start year must be at least 1900; the suffix must be the last two digits of the following year. `1999-00` is valid. Birthday is still a full date, and audit timestamps remain timestamps.

This applies to Years Active, levels, current school_year, Drill/Drum years, PBE/TLT history, all RZE results, honors earned, staff_history, and year-linked catalogs. Sort by the full starting year. Duplicate ranges in a single years array are rejected.

The user-approved migration maps standalone 2024 to `2023-24`; long ranges such as `2023-2024` shorten to `2023-24`. Existing undated levels retain null years and display Year unknown. Existing history was classified as Pathfinder history; current status does not reclassify the past. Unknown Drill teams remain null. The existing person's first/last names and Staff status were explicitly confirmed before conversion.

`private.member_revision_backup` retains the pre-migration records for administrator review and is inaccessible to browser users. Migration history remains intact; future changes use new migrations.

## Levels

Names in progression order: Friend, Companion, Explorer, Ranger, Voyager, Guide, Pioneer, Navigator.

Outcomes: **Basic**, **Advanced**, **Incomplete**, stored as `basic`, `advanced`, `incomplete`. Any is a search choice, not a stored outcome. Incomplete is recorded progress, not an earned completion.

```json
[
  { "name": "Friend", "outcome": "basic", "year": "2023-24" },
  { "name": "Companion", "outcome": "incomplete", "year": "2024-25" },
  { "name": "Explorer", "outcome": "advanced", "year": null }
]
```

Each object has exactly name, outcome, and year. Null year preserves unknown dates; new known achievements should use their actual range. Duplicate complete entries are rejected. Different outcomes for the same level/period may coexist as history; selecting Basic and Advanced requires both entries. Current enrollment is separate from this array.

## Activity history

Every detail table references `pathfinders.id` using `pathfinder_id`. Each has `history_role` (`pathfinder` or `staff`, default Pathfinder). Set this to the role when the activity occurred, independently of today's status. This explicit association controls the two profile sections.

| Table | Columns besides pathfinder_id/history_role | Uniqueness / behavior |
|---|---|---|
| `drill` | id identity PK, team nullable text, years jsonb | One row per member/team/role, including an unknown team; nonempty years |
| `drum_corps` | id identity PK, drum_played text, years jsonb | One row per member/instrument/role; nonempty years |
| `pbe` | id identity PK, history jsonb | One row per member/role; each range paired with its books |
| `tlt` | id identity PK, history jsonb | One row per member/role; each range paired with its operations |

Drill teams: **Precision, Freestyle, Adult**. Adult is a team, not automatic evidence of a Staff role.

Drum instruments: **Snare, Quad, Bass, Tenor, Cymbol** (retaining the supplied spelling).

TLT operations: **Administrative, Outreach, Teaching, Activity, Records, Counseling**. Any allowed operation can accompany any valid TLT period. Starting years range from 2016 (the converted 2017 calendar-year minimum) through the current calendar year. Multiple different operations per period are allowed.

```json
[
  { "year": "2023-24", "operations": ["Teaching", "Records"] },
  { "year": "2024-25", "operations": ["Administrative"] }
]
```

PBE example:

```json
[
  { "year": "2021-22", "books": ["1 Kings", "Ruth"] },
  { "year": "2022-23", "books": ["John"] }
]
```

PBE/TLT histories are required nonempty arrays, with one object per unique period. Book/operation arrays contain unique valid strings; empty arrays preserve participation with unknown details. Do not combine multiple names into one comma-separated string.

### `pbe_year_books`

Read-only for authenticated users; administrator-managed catalog keyed by `(school_year, book_name)`. Each PBE book must belong to its entry's exact period. Catalog changes cannot invalidate saved history. Unknown periods may have empty book arrays but cannot accept books until configured.

| School year | Allowed Bible books |
|---|---|
| `2011-12` | 1 Samuel, Mark |
| `2012-13` | Acts, 1 Thessalonians, 2 Thessalonians |
| `2013-14` | 2 Samuel |
| `2014-15` | Matthew |
| `2015-16` | Exodus |
| `2016-17` | Galatians, Ephesians, Philippians, Colossians, 1 Timothy, 2 Timothy |
| `2017-18` | Daniel, Esther |
| `2018-19` | Luke |
| `2019-20` | Ezra, Nehemiah, Hosea, Amos, Jonah, Micah |
| `2020-21` | Hebrews, James, 1 Peter, 2 Peter |
| `2021-22` | 1 Kings, Ruth |
| `2022-23` | John |
| `2023-24` | Joshua, Judges |
| `2024-25` | Romans, 1 Corinthians, 2 Corinthians |
| `2025-26` | Isaiah (Chapters 1–33) |
| `2026-27` | Mark, 1 Peter, 2 Peter, 1 John, 2 John, 3 John |

## Red Zone Events (RZE)

Each table has `id` identity PK, `pathfinder_id` FK, `year` text range, `placement` text, and `history_role`. Named events also have a required `name` for the evaluation/event. Results sort newest first in the profile.

| Label | Table | Unique per |
|---|---|---|
| Drill Performance | red_zone_drill_performance | person/period/role |
| Drum Performance | red_zone_drum_performance | person/period/role |
| Honor Evaluations | red_zone_honor_evaluations | person/period/name/role |
| Bible Events | red_zone_bible_events | person/period/name/role |
| Knots Relay | red_zone_knots | person/period/role |
| Tents | red_zone_tents | person/period/role |
| Jump Rope | red_zone_jump_rope | person/period/role |
| Archery | red_zone_archery | person/period/role |
| Lashing | red_zone_lashing | person/period/role |
| Burning Twine | red_zone_burning_twine | person/period/role |

Placements are exactly **1st Place, 2nd Place, 3rd Place, Participation**. Each placement stays attached to its period and event. Honor Evaluation/Bible Event name catalogs remain future work: administrator-supplied names are stored on the records today. No assignments are invented.

### Future year-linked event catalogs (not implemented)

Fill in names before implementing restrictions. Both will use `YYYY-YY` period keys, not standalone calendar years. TBD is not an allowed stored name.

| Period | Allowed Honor Evaluation names | Allowed Bible Event names |
|---|---|---|
| To be filled in | TBD | TBD |

## Honors

`honors`: id identity PK, name unique text. `honors_earned`: id identity PK, pathfinder_id FK, honor_id FK, year_earned text range, history_role. Unique per person/honor/period/role. Detail rows cascade when a person is removed by an administrator; catalog honors cannot be deleted while referenced.

The search Honors control remains a placeholder. View Honors opens a separate WIP dialog and does not fetch honor records.

## Search and current results

The security-invoker `member_search` view returns one row per person, preserving RLS, server-side counts, and pagination. Current Data is left-joined for the selected club season. Missing current data defaults to Not Active. First and Last are separate displayed columns; the derived full name supports combined name searching. Results sort by last name, first name, and internal ID.

Visible columns: **First, Last, Status, Title, Current activities**. First opens the profile. Title is current_title for Pathfinder/Staff (Not recorded if null), and N/A for Parent/Not Active. Inactive current activities display N/A. Historical activities never masquerade as current participation.

- Years Active accepts an exact range or a single calendar year. 2024 matches `2023-24` or `2024-25`.
- Levels offer a period and Any/Basic/Advanced/Incomplete outcome. Name/outcome/year must match one level entry; unknown years match only Any year.
- Activity and RZE selectors offer exact ranges and single calendar years, plus Any year. All detail ranges contribute both endpoints to calendar-year searches, including TLT and RZE.
- Drill teams, Drum instruments, TLT operations, and RZE placements refine those choices. Name/year/detail must match the same history record. Bubbles within a category combine with OR; categories combine with AND.
- Any year and dated participation searches read the detail tables, not current registration. Activity queries search both historical roles without filtering by current Status unless explicitly selected.

Computed view fields `search_activities`, `search_activity_years`, `search_events`, `search_event_years`, `search_activity_details`, and `search_event_details` support these filters before pagination. First/last name search is case-insensitive and escapes wildcard characters.

## Profile overlay

1. Full name and current Status.
2. Birthday displayed MM/DD/YYYY, or Not recorded.
3. **Pathfinder History**: Years Active, Levels with outcome and period, activity sections with linked details, separate RZE mini cards, and View Honors.
4. **Staff History**: staff_history years/titles, and activity/RZE records explicitly marked staff.
5. **Notes**: multiline plain-text editor with Save Notes, pending/success/error states, and an unsaved-changes notice. Closing does not automatically save.

Both role sections remain identifiable, with empty messages when their summary history is unknown. Activity/event subsections without records are omitted. Current Staff status never hides past Pathfinder records. Staff titles can be supplied later without assigning guessed titles now.

The overlay preserves filters/results/pagination, supports loading/retry and mobile scrolling, prevents stale requests from rendering, and returns focus to its opener. Honors preserves the underlying profile and closes independently with Escape or Close.

## Future rollover

Automatic rollover is not implemented. A future role-aware registration archive must preserve outgoing status, current_title, current activities, and period before starting a new season. Do not infer earned levels from current titles or infer operation/result dates from current registration. Birthday and Notes remain person-level fields rather than duplicated annual data.


## Shared year search

The **Years** control now applies to Levels, Extracurricular, and Red Zone Events together. Category dropdowns contain only the names and their outcome/team/instrument/operation/placement choices, never years. For example, Years = 2023-24, Levels = Basic or Advanced Friend, and Extracurricular = Snare or Teaching finds people with either selected Friend outcome AND either activity detail, each recorded in 2023-24. Multiple years match any selected year. Without years, the selected categories search all history. With only years selected, browse participation years. Calendar-year selections retain adjacent-period matching. Unknown level years cannot match a specific year.

Honors is still an empty placeholder; its future implementation must use the same shared years and within-category OR behavior. No honors records are fetched or falsely matched by the placeholder today.
