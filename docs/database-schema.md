# FLC Pathfinder Database Schema

Implemented September 14, 2026. React/Vite uses Supabase PostgreSQL and Auth. All authenticated accounts remain trusted application users; person Status is participation information, not an authorization role. Anonymous access and deletion of permanent member profiles are denied by RLS/permissions. Authenticated users can remove history entries through the reviewed profile save; Current Registration is required.

## Achievements and Staff search update

Implemented in the repository by [20260916050000_achievements_staff_search.sql](../supabase/migrations/20260916050000_achievements_staff_search.sql) and its matching frontend changes. Apply the migration before deploying this frontend; repository implementation does not mean it has been applied to a hosted project.

- **Master Guide** is now an achievement in `pathfinders.levels`, with exactly `name` and `year`; it has no outcome field. It appears alongside the eight classes in the profile, addition form, and editor. Master Guide Leader remains a Staff title.
- Historical Master Guide titles become achievement entries preserving every distinct recorded year, including Unknown. A current-only Master Guide title becomes an Unknown-year achievement; the registration season is never inferred as an award date. Other titles and empty-but-dated Staff participation remain intact.
- Before conversion, the migration saves affected people and Staff histories in `private.master_guide_members_backup` and `private.master_guide_history_backup`, and all registrations in `private.achievements_registration_backup`. These backups are unavailable to browser users.
- **History type** selects Pathfinder or Staff search. Pathfinder offers the eight classes plus plain Master Guide; Staff loads catalog titles without variants. Switching modes clears this category's draft selections. Search still applies on submission. Staff filters match `search_staff_titles` objects containing name and year from the same historical entry, independently of current Status.
- Search menus close after successful mouse or keyboard selection, exposing the selected bubble while retaining multi-selection through reopening. This also applies to recipient Search; other forms retain their existing picker behavior.
- `current_data.current_activities` is removed from the table, view projections, registration editor, types, receipts, and save allowlist. All historical activity tables remain intact.
- A dedicated accessible profile icon button sits immediately to the left of First Name. First Name is plain text. Recipient selection retains its separate checkbox.

The database regression suite checks migration preservation, removed-field dependencies, title/year matching, outcome-free Master Guide validation, duplicate protection, reviewed edits, and permissions. Browser tests cover the search-mode switch, catalog retry, menu closing, profile icon, and Master Guide addition/editing/display.

## Person and current data

### `pathfinders`

One permanent row per person, including Pathfinder, Staff, Parent, and inactive people. IDs remain internal and are never name-based.

| Column                     | Type                   | Meaning                                                                                                         |
| -------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`                       | integer identity       | Permanent primary key                                                                                           |
| `first_name`               | text                   | Trimmed, 1-200 characters                                                                                       |
| `last_name`                | text                   | Trimmed, up to 200 characters; blank allowed when unknown                                                       |
| `years_active`             | jsonb                  | Unique participation ranges, e.g. `["2023-24"]`; Add Record initializes this with Current Year for every status |
| `levels`                   | jsonb                  | Level/outcome/year entries described below                                                                      |
| `birth_date`               | date, nullable         | Birthday; display MM/DD/YYYY without timezone conversion                                                        |
| `notes`                    | text, nullable         | Multiline plain text; displayed as plain text in the profile; editable through Edit Profile                     |
| `creation_request_id`      | uuid, nullable, unique | Internal Add Record request identifier; prevents duplicate creation when the same form is retried               |
| `created_at`, `updated_at` | timestamptz            | Creation and automatically updated modification time                                                            |

The old name, graduated, extracurriculars, and red_zone_participation columns are removed. Full display/search names are derived from first and last names. Historical participation comes from detail tables.

### `current_data`

At most one row per person. `current_club_year()` selects `2026-27`; this changes only through an intentional rollover, not automatically in January.

| Column                     | Type            | Meaning                                                                                                      |
| -------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------ |
| `pathfinder_id`            | integer PK/FK   | References the permanent person                                                                              |
| `school_year`              | text            | Required `YYYY-YY` range; defaults to current_club_year() for new rows; internal club-season selection       |
| `status`                   | text            | Pathfinder (`pathfinder`), Staff (`staff`), Parent (`parent`), Not Active (`not_active`); default Not Active |
| `current_title`            | jsonb, nullable | Unique array of Pathfinder classes or Staff titles, validated against status                                 |
| `created_at`, `updated_at` | timestamptz     | Maintained timestamps                                                                                        |

Grade is removed. For Pathfinder, each current_title entry must be one of the eight level names. For Staff, each title must come from `staff_titles`; the catalog is seeded with the titles below. Multiple titles/classes may be stored, e.g. `["Club Director", "Drill Instructor"]` for Staff. Unknown titles remain null or an empty array. Current activities are no longer stored in registration. Original current data is retained in administrator-only `private.current_title_json_backup`. Parent/Not Active must have null titles. Changing status requires a compatible title or clearing it. Current classes do not imply earned achievements.

### `staff_titles` and `staff_history`

`staff_titles(title text primary key, sort_order integer not null default 1000)` holds allowed staff titles and their ranking; authenticated users may read the catalog, and administrators configure it. Referenced titles cannot be removed in a way that invalidates saved current or historical data. No placeholder title is stored.

1. Club Director
2. Associate Director
3. Treasurer
4. Administrative Assistant
5. Friend Counselor
6. Companion Counselor
7. Explorer Counselor
8. Ranger Counselor
9. Voyager Counselor
10. Guide Counselor
11. Pioneer Counselor
12. Navigator Counselor
13. Master Guide Leader
14. PBE Leader
15. Drum Corps Leader
16. Drill Leader
17. TLT Leader
18. PBE Instructor
19. Drum Instructor
20. Drill Instructor
21. TLT Instructor
22. Medical
23. Security
24. Equipment
25. Trailer
26. Camping
27. IT
28. Audio/Visual
29. Social Media
30. Photography
31. Junior Staff

`staff_history` contains `id` (identity primary key), `pathfinder_id` (unique FK), and `history` (nonempty JSON array). One row per member, with one entry per unique period and multiple titles allowed per period. Titles come from `staff_titles` but are not restricted to particular years. Empty title arrays preserve participation with an unknown title. Validation and catalog-protection triggers prevent invalid references. Staff years are included in Years Active search.

```json
[
  { "year": "2023-24", "titles": ["Friend Counselor", "Drill Instructor"] },
  { "year": "2024-25", "titles": [] }
]
```

## Year ranges and migration

All stored participation/achievement years use consecutive `YYYY-YY` ranges, e.g. `2012-13`, `2023-24`, `2026-27`. Historical entries may instead have a null year (displayed as Unknown). Known years: the four-digit start year must be at least 1900; the suffix must be the last two digits of the following year. `1999-00` is valid. Birthday is still a full date, and audit timestamps remain timestamps.

This applies to Years Active, levels, current school_year, Drill years, Drums/PBE/TLT history, all RZE results, honors earned, staff_history, and year-linked catalogs. Sort by the full starting year. Duplicate ranges in a single years array are rejected.

The user-approved migration maps standalone 2024 to `2023-24`; long ranges such as `2023-2024` shorten to `2023-24`. Existing undated levels retain null years and display Year unknown. Existing history was classified as Pathfinder history; current status does not reclassify the past. Unknown Drill teams remain null. The existing person's first/last names and Staff status were explicitly confirmed before conversion.

`private.member_revision_backup` retains the pre-migration records for administrator review and is inaccessible to browser users. Migration history remains intact; future changes use new migrations. The staff/drum history migration preserves period/detail associations and retains original rows in administrator-only `private.staff_drum_history_backup`.

## Levels

Names in progression order: Friend, Companion, Explorer, Ranger, Voyager, Guide, Pioneer, Navigator.

For the eight classes, outcomes: **Basic**, **Advanced**, **Incomplete**, stored as `basic`, `advanced`, `incomplete`. Any is a search choice, not a stored outcome. Incomplete is recorded progress, not an earned completion.

```json
[
  { "name": "Friend", "outcome": "basic", "year": "2023-24" },
  { "name": "Companion", "outcome": "incomplete", "year": "2024-25" },
  { "name": "Explorer", "outcome": "advanced", "year": null }
]
```

Each ordinary class object has exactly name, outcome, and year. Master Guide instead has exactly name and year, for example `{ "name": "Master Guide", "year": "2025-26" }`; its outcome property must be absent. Null year preserves unknown dates; new known achievements should use their actual range. Duplicate complete entries are rejected. Different outcomes for the same level/period may coexist as history; selecting Basic and Advanced in search matches either entry. Current enrollment is separate from this array.

## Activity history

Every detail table references `pathfinders.id` using `pathfinder_id`. Activities and Red Zone events always appear in Pathfinder History, regardless of current status. These tables have no `history_role` column. Staff History contains staff titles only.

| Table        | Columns besides pathfinder_id                   | Uniqueness / behavior                                                               |
| ------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `drill`      | id identity PK, team nullable text, years jsonb | One row per member/team, including an unknown team; nonempty years                  |
| `drum_corps` | id identity PK, history jsonb                   | One row per member; each range paired with its instruments                          |
| `pbe`        | id identity PK, history jsonb                   | One row per member; each range paired with its books and optional region placements |
| `tlt`        | id identity PK, history jsonb                   | One row per member; each range paired with its operations                           |

Drill teams: **Precision, Freestyle, Adult**. Adult is a team, not automatic evidence of a Staff role.

Drum instruments: **Snare, Quad, Bass, Tenor, Cymbol** (retaining the supplied spelling). Multiple instruments may accompany any valid period, without a year-specific catalog.

```json
[
  { "year": "2023-24", "drums": ["Snare", "Bass"] },
  { "year": "2024-25", "drums": ["Tenor"] }
]
```

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
  {
    "year": "2021-22",
    "books": ["1 Kings", "Ruth"],
    "results": { "Area": "1st Place", "State": "Participation" }
  },
  { "year": "2022-23", "books": ["John"] }
]
```

Staff/Drums/PBE/TLT histories are required nonempty arrays, with one object per unique period. Title/instrument/book/operation arrays contain unique valid strings; empty arrays preserve participation with unknown details. Do not combine multiple names into one comma-separated string.

PBE entries may include an optional `results` object keyed by **Area**, **State**, **Union**, and **Divisional**. Each region maps to exactly one of **1st Place**, **2nd Place**, **3rd Place**, or **Participation**. Regions follow Area ? State ? Union ? Divisional: new results for a later region require placements for all earlier regions, including any already saved for that year. No regions is also allowed; existing books-only records remain valid. Add to Record offers a grouped MultiSelect with placement buttons under each region, one placement per region. Later regions are disabled until the earlier ones are selected; removing a region clears later selections. The books notice appears above Select profiles without a heading. Results appear in confirmation and receipts. Pathfinder History displays only compact region results, such as `Area (1st), State (P)`; books remain stored. Books-only entries show `Results not recorded`. Repeated results are skipped, new regions are merged, and conflicting saved placements produce a per-profile error without overwriting data. The migrations are `20260915200000_pbe_region_results.sql` and `20260915210000_pbe_region_progression.sql`. Previously saved incomplete region sequences are preserved.

### `pbe_year_books`

Read-only for authenticated users; administrator-managed catalog keyed by `(school_year, book_name)`. Each PBE book must belong to its entry's exact period. Catalog changes cannot invalidate saved history. Unknown periods may have empty book arrays but cannot accept books until configured.

| School year | Allowed Bible books                                                 |
| ----------- | ------------------------------------------------------------------- |
| `2011-12`   | 1 Samuel, Mark                                                      |
| `2012-13`   | Acts, 1 Thessalonians, 2 Thessalonians                              |
| `2013-14`   | 2 Samuel                                                            |
| `2014-15`   | Matthew                                                             |
| `2015-16`   | Exodus                                                              |
| `2016-17`   | Galatians, Ephesians, Philippians, Colossians, 1 Timothy, 2 Timothy |
| `2017-18`   | Daniel, Esther                                                      |
| `2018-19`   | Luke                                                                |
| `2019-20`   | Ezra, Nehemiah, Hosea, Amos, Jonah, Micah                           |
| `2020-21`   | Hebrews, James, 1 Peter, 2 Peter                                    |
| `2021-22`   | 1 Kings, Ruth                                                       |
| `2022-23`   | John                                                                |
| `2023-24`   | Joshua, Judges                                                      |
| `2024-25`   | Romans, 1 Corinthians, 2 Corinthians                                |
| `2025-26`   | Isaiah (Chapters 1–33)                                              |
| `2026-27`   | Mark, 1 Peter, 2 Peter, 1 John, 2 John, 3 John                      |

## Red Zone Events (RZE)

Each table has `id` identity PK, `pathfinder_id` FK, `year` text range, `placement` text. Named events also have a required `name` for the evaluation/event. Known results sort newest first in the profile; Unknown results follow with spacing.

| Label             | Table                      | Unique per                   |
| ----------------- | -------------------------- | ---------------------------- |
| Drill Performance | red_zone_drill_performance | person/period/placement      |
| Drum Performance  | red_zone_drum_performance  | person/period/placement      |
| Honor Evaluations | red_zone_honor_evaluations | person/period/name/placement |
| Bible Events      | red_zone_bible_events      | person/period/name/placement |
| Knots Relay       | red_zone_knots             | person/period/placement      |
| Tents             | red_zone_tents             | person/period/placement      |
| Jump Rope         | red_zone_jump_rope         | person/period/placement      |
| Archery           | red_zone_archery           | person/period/placement      |
| Lashing           | red_zone_lashing           | person/period/placement      |
| Burning Twine     | red_zone_burning_twine     | person/period/placement      |

Placements are exactly **1st Place, 2nd Place, 3rd Place, Participation**. Each placement stays attached to its period and event. Honor Evaluation/Bible Event name catalogs remain future work: administrator-supplied names are stored on the records today. No assignments are invented.

### Future year-linked event catalogs (not implemented)

Fill in names before implementing restrictions. Both will use `YYYY-YY` period keys, not standalone calendar years. TBD is not an allowed stored name.

| Period          | Allowed Honor Evaluation names | Allowed Bible Event names |
| --------------- | ------------------------------ | ------------------------- |
| To be filled in | TBD                            | TBD                       |

## Honors

`honors`: id identity PK, name unique text, category text, skill_level smallint (1, 2, or 3), and year integer. Catalog year is the honor's introduction year, independent of club seasons and year earned; null means **Unknown**. Skill level remains null when the source does not publish it. Category may be null for an unmatched legacy entry; populated categories must be nonempty and trimmed. Master Award relationships are planned below and are not yet implemented.

The September 18 migration prepares the three metadata columns without importing honors. A separate staged import contains 602 NAD-listed and Florida Conference honors. Different-year editions have the year appended to their names, including Unknown where applicable. Existing IDs and earned-honor references are retained; ambiguous legacy names are not reassigned to an edition. See [catalog sources and import decisions](honors-catalog.md).

`honors_earned`: id identity PK, pathfinder_id FK, honor_id FK, year_earned text range. Unique per person/honor/period. Detail rows cascade when a person is removed by an administrator; catalog honors cannot be deleted while referenced.

The general Search Honors filter remains a placeholder. Add to Record searches the `honors` catalog as the user types, showing up to 20 matches at a time. View Honors fetches earned honors with their years in a separate dialog. Catalog entries are supplied by migrations or an administrator; the app does not invent honors.

### Planned honors selection — schema notes only

These requirements apply when searching for honors, adding earned honors, and editing earned honors. They are recorded for later implementation; this note does not change the current UI, stored catalog, or database constraints.

- When the honor search bar is empty (including whitespace-only input), show no honor results and do not fetch the catalog. Once the user types a non-whitespace character, show related matching honors. Clearing the bar hides results again and prevents an earlier request from repopulating them. Existing selections remain visible.
- Try a grouped **MultiSelect**: category names are the group headings, and individual honor names appear as small selectable bubbles within their groups. Use the edition-qualified name, including its year suffix when needed, so different honors remain distinguishable.
- The grouped MultiSelect is provisional and may be replaced immediately after trying it. Keep its presentation easy to swap without changing honor IDs, catalog data, or earned-honor records.

Use these category labels and this order:

1. Arts & Crafts
2. Health & Science
3. Household Arts
4. Nature
5. Outdoor Industries
6. Outreach
7. Recreation
8. Vocational
9. Florida
10. Master Award

For future grouping, map source **Arts, Crafts and Hobbies** to **Arts & Crafts**, **Health and Science** to **Health & Science**, and **Spiritual Growth, Outreach and Heritage** to **Outreach**. Florida Conference honors belong under **Florida** (the staged source catalog currently labels them Regional and identifies their Florida scope). The other standard category names already match. These are planned display labels; no live catalog values are rewritten yet. Use **Master Award**, replacing the earlier label Masters.

### Planned Master Award catalog and requirements

Use the [wiki Master Awards index](https://wiki.pathfindersonline.org/w/AY_Honors/Masters/en) and each linked award's requirement list. Keep the existing NAD scope: include its 15 current NAD awards, exclude awards explicitly marked unavailable in NAD, and omit the retired Witnessing Master Award. This is separate from the Master Guide class/achievement.

Reserve one catalog entry per award, categorized **Master Award**, even if its requirements need manual input later. The prepared catalog at `supabase/catalogs/honors.json` now has a `master_awards` section containing all 15 awards and their retrieved requirement groups. Here, honors_catalog refers to the prepared catalog; the live table is still named `honors`, and no table rename or award import is being applied.

Each award requires **seven distinct eligible honors**, drawn from its own list. Several awards also impose group minimums, so a single unrestricted seven-of-list check would be insufficient:

| Award                           | Requirement groups                               |
| ------------------------------- | ------------------------------------------------ |
| Aquatic                         | Any 7 listed honors                              |
| Artisan                         | Any 7 listed honors                              |
| Conservation                    | Any 7 listed honors                              |
| Family, Origins, and Heritage   | 2 Heritage choices + 5 additional choices        |
| Farming                         | Any 7 listed honors                              |
| Health                          | 3 from group 1 + 2 from group 2 + 2 from group 3 |
| Homemaking                      | Any 7 listed honors                              |
| Modern Technology               | Any 7 listed honors                              |
| Naturalist                      | 4 flora + 2 wild fauna + 1 domestic fauna        |
| Recreation                      | Any 7 listed honors                              |
| Spiritual Growth and Ministries | 3 Spiritual Growth + 4 Ministries                |
| Sportsman                       | Any 7 listed honors                              |
| Technician                      | Any 7 listed honors                              |
| Wilderness                      | Any 7 listed honors                              |
| Zoology                         | 1 foundation + 4 wild fauna + 2 domestic fauna   |

The future database model must support an award's total requirement, ordered requirement groups with their own required counts, and links from each group to eligible honor IDs. Honor membership is many-to-many and must reference the exact catalog edition, not just a category or unqualified name. Repeated earned records for the same honor do not count as multiple distinct honors toward one award.

Preserve source URLs and a requirements/mapping status. If an award list cannot be retrieved, retain its award entry, total of seven, and empty requirement groups marked pending manual input; an empty list must never imply that any honor qualifies. All 15 lists were retrieved in this pass. Some source choices refer to other regional editions or honors outside the prepared catalog: preserve those source references with `catalog_name: null` and `mapping_status: needs_review` for later manual resolution, without adding out-of-scope honors or guessing equivalent editions. Source-listed substitutions and example-based lists also need review before automated eligibility checks.

Only schema notes and prepared catalog data are updated here. Award selection, eligibility calculations, automatic awarding, earned-award storage, and cross-award honor reuse policies remain unimplemented.

## Search and current results

The security-invoker `member_search` view wraps `member_search_base` and returns one row per person, preserving RLS, server-side counts, and pagination. Current Data is left-joined for the selected club season. Missing current data defaults to Not Active. First and Last are separate displayed columns; the derived full name supports combined name searching. Computed `sort_status`, `sort_title`, `sort_last_name`, and `sort_first_name` fields implement the order below.

### Automatic member ordering

Apply this order whenever a search displays a member table, including the recipient search in Add to Record:

1. **Current Status:** Pathfinder, Staff, Parent, Not Active.
2. **Current Class/Title within that status:**
   - Pathfinder: Friend, Companion, Explorer, Ranger, Voyager, Guide, Pioneer, Navigator.
   - Staff: the exact numbered priority order in **`staff_titles` and `staff_history`** above (Club Director first, Junior Staff last), using the updated schema list as the source of truth. If a person has multiple current titles, use the highest-priority title (lowest numbered rank) as the sorting key; continue displaying all their titles.
   - Parent and Not Active: no title ordering; these statuses have no titles.
   - Pathfinder/Staff profiles with no recorded or ranked title sort after ranked titles within their status. For legacy Pathfinder records with multiple classes, use the earliest class in the progression as the sorting key.
3. **Last Name:** alphabetical, case-insensitive.
4. **First Name:** alphabetical, case-insensitive.
5. Internal person ID breaks otherwise identical ties for stable pagination.

Sort the complete matching result set on the server **before pagination**, rather than sorting only the displayed page. Staff priority comes from the catalog's `sort_order` column; neither alphabetical order nor table insertion order defines Staff priority. This ordering uses current registration, not earned levels or historical titles.

Visible columns: **Profile, First Name, Last Name, Status, Class/Titles**. The profile icon opens the historical popup; First Name is ordinary text. Title is current_title for Pathfinder/Staff (Not recorded if null), and N/A for Parent/Not Active.

- Years Active accepts an exact range or a single calendar year. 2024 matches `2023-24` or `2024-25`.
- History type selects Pathfinder achievements or Staff titles. Shared Years constrain the selected achievement/title within its own entry. Ordinary classes offer Any/Basic/Advanced/Incomplete; Master Guide and Staff titles have no outcome variants. Unknown years match only searches without a specific year.
- Activity and RZE selectors offer exact ranges and single calendar years, plus Any year. All detail ranges contribute both endpoints to calendar-year searches, including TLT and RZE.
- Drill teams, Drum instruments, TLT operations, and RZE placements refine those choices. Name/year/detail must match the same history record. Bubbles within a category combine with OR; categories combine with AND.
- Any year and dated participation searches read the detail tables, not current registration. Activity queries search all recorded participation without filtering by current Status unless explicitly selected.

Computed view fields `search_activities`, `search_activity_years`, `search_events`, `search_event_years`, `search_activity_details`, and `search_event_details`, and `search_staff_titles` support these filters before pagination. First/last name search is case-insensitive and escapes wildcard characters.

## Profile overlay

1. Full name and current Status.
2. Birthday displayed MM/DD/YYYY, or Not recorded.
3. **Pathfinder History**: Years Active, Levels with outcome and period (Master Guide has only its name and year), activity sections with linked details, separate RZE mini cards, and View Honors.
4. **Staff History**: staff_history period/title entries only.
5. **Notes**: read-only multiline text. Use Edit Profile and its confirmation receipt to save changes.

Both role sections remain identifiable, with empty messages when their summary history is unknown. Activity/event subsections without records are omitted. Current Staff status never hides past Pathfinder records. Staff titles can be supplied later without assigning guessed titles now.

The overlay preserves filters/results/pagination, supports loading/retry and mobile scrolling, prevents stale requests from rendering, and returns focus to its opener. Honors preserves the underlying profile and closes independently with Escape or Close.

## Add page sections and labels

Keep the creation and history-addition actions in the Add area alongside Search:

- **Add New Profile** opens the new-person registration flow documented below.
- **Add to Record**, below new-profile creation, opens the flow for adding information to one or more existing profiles.
- **Edit Profiles** is a separate placeholder tab for future changes to existing data. It is not part of Add to Record.

The Add tab provides both actions. Edit Profiles has its own placeholder tab for future work on changing existing data. Existing database function names and the creation flow remain unchanged.

## Add New Profile flow

The Add page includes Add New Profile, with status-dependent choices, the configured current year, and a five-second confirmation countdown. Confirm calls `add_member_record` in Supabase and shows Record Added only after saving succeeds. Changing existing profile data remains future work.

The **Add New Profile** button opens a modal form for creating a person and current registration.

### Form fields

| Label        | Stored field                 | Behavior                                                                                                          |
| ------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| First Name   | `pathfinders.first_name`     | Required; trim whitespace; 1-200 characters                                                                       |
| Last Name    | `pathfinders.last_name`      | Trim whitespace; up to 200 characters; blank allowed when unknown under the existing schema                       |
| Status       | `current_data.status`        | Select Pathfinder, Staff, Parent, or Not Active                                                                   |
| Birthday     | `pathfinders.birth_date`     | Date input; store a date without timezone conversion; blank stores null                                           |
| Class/Title  | `current_data.current_title` | Pathfinder: one class; Staff: multiple titles allowed. Stored as an array; unknown titles may remain unselected   |
| Current Year | `current_data.school_year`   | Autofill from the configured `current_club_year()`; display the full range, e.g. `2026-2027`, and store `2026-27` |

The configured club year is the source of truth for autofill. Follow the existing intentional season rollover rather than changing the year automatically in January or guessing a school-year boundary. Reopening the form uses the configured current year.

### Status-dependent Class/Title

- **Pathfinder:** offer only Friend, Companion, Explorer, Ranger, Voyager, Guide, Pioneer, and Navigator in a single-selection dropdown. The Add RPC also rejects multiple classes. Existing registrations are not rewritten.
- **Staff:** load the allowed options from the `staff_titles` table. Do not hardcode a separate title catalog or allow free-text titles. Show loading/error/retry states if the catalog cannot be retrieved.
- Group Staff choices using the search dropdown's inner buttons: **Counselor** contains the eight classes; **Instructor** contains Drill, Drums, PBE, and TLT; **Leader** contains those four activities plus Master Guide. Remaining titles appear under **Other**, after Counselor, Instructor, and Leader. Headings are not selectable; multiple titles within a group are allowed. Inner labels are shortened for display, while selections retain the exact catalog title (e.g. Drums under Leader selects `Drum Corps Leader`). Only titles present in the catalog are offered.
- **Parent / Not Active:** disable Class/Title, display N/A, and store null.
- Changing Status clears incompatible Class/Title selections. Selected classes describe current enrollment and do not create earned level entries.

### Add and timed confirmation

1. The form initially shows an **Add** button. Clicking it validates the fields; validation errors keep the form in the Add state and identify the fields to correct.
2. Once valid, request confirmation in the same modal and change the button to **Confirm (5s)**. Count down the remaining seconds on the button. Five seconds is the initial confirmation window.
3. Clicking Confirm within that window submits the record. Expiration restores **Add** without submitting or clearing the entered values. The timeout never submits automatically.
4. Any field change cancels confirmation and restores Add, so confirmation always applies to the values reviewed. Closing the modal cancels its timer and discards the unsaved form.
5. Confirm replaces the form with an **Adding Record** loading screen until Supabase responds; repeat submission and modal closing are disabled. On success, show **Record Added** with a quick summary of First Name, Last Name, Status, Birthday, Class/Title, and Current Year. Close returns to the Add / Edit Profiles page. Search refreshes using its existing filters and page, so a new record appears when it matches those filters. On failure, show an **Unable to Add Record** screen explaining the error, with **Back to form** to restore all inputs for correction or a fresh confirmation, and Close to leave.

### Persistence requirements

`add_member_record(p_request_id, p_first_name, p_last_name, p_birth_date, p_status, p_current_title, p_school_year)` returns the generated integer person ID. It creates one `pathfinders` row and its linked `current_data` row in one transaction, so a failed registration cannot leave a partially created profile. The security-invoker function requires an authenticated user and respects existing RLS and validation. It trims names and rejects a stale school year.

The migration `20260915140000_add_record.sql` adds this function and the nullable unique `pathfinders.creation_request_id` column; existing people remain unchanged. The form keeps a random request UUID across retries. Transaction-level locking serializes identical requests; a successful retry with identical details returns the existing ID. Reusing that request with different details is rejected with a prompt to check Search. This protects retries within the same open form; a new form is a new request, and names are not unique identifiers.

The migration `20260915150000_add_record_years_active.sql` makes new Add Record submissions initialize `pathfinders.years_active` with the selected Current Year (e.g. `["2026-27"]`), for every status. This is saved in the same transaction as the person and current registration; retries do not duplicate the year. Existing records are not backfilled.

Other fields use existing database defaults and validation, including Staff current activities normalized to `["N/A"]`. Earned levels and activity/event records are not inferred from this current registration form.

`20260915160000_add_record_validation.sql` rejects a new Add request when both First Name and Last Name match an existing person, case-insensitively after trimming surrounding spaces (including matching blank last names). The error states that the profile already exists and directs the user to Search. The name check and insert are serialized in the transaction to prevent simultaneous Add requests from creating duplicates. A retry of an already successful request still returns its original ID. Existing duplicate profiles are preserved; direct administrator edits remain governed by the existing table constraints.

## Add to Record flow: add history to existing profiles

**Add to Record** adds documentation to existing profiles. Changing or removing existing data belongs to the separate future **Edit Profiles** section. The `20260915170000_history_additions.sql` migration implements ranking and the batch history operation.

### Year and documentation choice

1. Clicking **Add to Record** opens a dialog with **Information category** first and **Year to document** second. Years run from the configured current club year back through `2010-11`, newest first, using `YYYY-YY`, plus **Unknown**. All dropdowns except Information category support **Type or choose?**, with one selection for year, class/title, outcome, team, event, and placement. Recipient profiles are selected after the information to add is defined.
2. Choose exactly one documentation category per entry: **Level Earned**, **Extracurricular**, **Red Zone Events**, or **Honors**.
3. Show the relevant choices and any further detail options underneath that category. The same year and documentation will be added to each selected existing profile.

| Category        | Choices and dependent details                                                   | Existing storage / planning notes                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Level Earned    | Select exactly one of the eight Pathfinder classes, or one existing Staff title | Pathfinder achievements use `pathfinders.levels` with name, selected Basic/Advanced/Incomplete outcome, and year. Staff class means a title from `staff_titles`, saved into `staff_history` for that year.                                                                                                  |
| Extracurricular | Select Drill, Drum, PBE, or TLT, then details                                   | Drill: one team; Drum: one or more instruments; PBE: automatically include all books from the selected year's catalog, displayed for review without individual selection; TLT: one or more operations. Existing values are merged rather than replaced. PBE book selection may change in a future revision. |
| Red Zone Events | Select one event and placement                                                  | Placements: 1st Place, 2nd Place, 3rd Place, Participation. Honor Evaluations and Bible Events also require a typed name. Different existing placements are reported as conflicts, not overwritten.                                                                                                         |
| Honors          | Type an honor name and select one catalog match                                 | Database-backed suggestions read `honors`; additions use `honors_earned` for person/year. No free-text catalog creation.                                                                                                                                                                                    |

### Eligibility by role

The form does not ask for Historical Role. **Only Staff titles exclude profiles whose current Status is Pathfinder**, both in recipient search and at save time. Activities, events, honors, and Pathfinder levels do not apply that exclusion.

The batch function does not assign a historical role. Levels, extracurriculars, and Red Zone events belong to Pathfinder History; staff titles belong to Staff History. Honors are independent of role. Current Staff can still receive documentation of past Pathfinder participation.

### Search and select recipient profiles

After defining the year and documentation, present a profile search similar to the existing Search feature. Users can search for existing profiles and **check/select or uncheck/deselect any number of eligible profiles** to receive that same information.

The search-and-selection modal expands to nearly the full viewport. Selected profiles appear in a horizontal, wrapping checkbox list **below** the search results and pagination, followed by Finish / Done. **Back to information** clears the selected profiles. Option lists float over surrounding content, opening above or below the input to fit the viewport, without moving the form below them. PBE books appear as comma-separated text beside the notice that all books for the selected year will be added.

- Track selection by permanent person ID, not by name.
- Preserve checked profiles when the user changes searches, filters, or result pages, so they can gather recipients across multiple searches. Provide a visible selection count and a way to review and deselect chosen profiles.
- Apply the eligibility rules to the available recipients. If the documentation changes, revalidate the selection and identify/remove any newly ineligible recipients before confirmation.
- Require at least one eligible selected profile before enabling **Finish / Done**. This button opens the final review; it does not write records.

### Final review and submission

1. **Finish / Done** opens a final confirmation screen with a quick transcript/receipt of **what will be added and to whom**: the year, category, chosen class/title/activity/event/honor, applicable details such as outcome or placement, and every selected recipient's name. Include current Status where useful for distinguishing recipients and reviewing eligibility.
2. Allow the user to return to the preceding steps to adjust the information or recipient selection before saving.
3. The final **Confirm** button is **not timed**. Only this confirmation submits the documentation for the reviewed recipients.
4. After Confirm, the final modal shows a **loading state** while the information is being saved. Prevent repeat submission while it is pending.
5. On a request failure, show an **error state explaining why**, retaining information and recipients for retry. Per-profile failures appear under **Not added** with reasons; other profiles can still succeed. Existing information is a normal skipped outcome. Review failed profiles returns to the form with just those recipients selected. A retry checks existing information again, so it cannot duplicate an earlier successful addition.
6. On completion, show a final receipt listing **Added** profiles and **Already had this information** profiles, with counts for each group and the documented information. If every selected profile already had the information, show that outcome without reporting an error or claiming new additions. Close returns to the main page.

Recheck recipient eligibility on the backend when saving, including the current-Status exclusion for Staff titles, so a status change after selection cannot bypass the rule.

### Preserve existing records

New documentation must preserve all previously recorded years, achievements, activities, results, and honors. For tables that store multiple periods/details in one JSON array, adding documentation means appending or merging new entries while retaining existing values.

For each selected profile, ensure the documented year is present in **both** `pathfinders.years_active` and the relevant category's history entry. Append the year to `years_active` only if missing, retaining all previous years. Save the year with the specific information in the appropriate table/JSON history structure as well. These changes must succeed together for that profile; a failed category write must not leave only a new Years Active entry.

Check each selected profile using the category-specific scope below (all years for levels and TLT; the documented year for other categories). If it already has all of that category information, report **Already had this information** and, except for entirely duplicate levels or TLT operations, still add the year to `years_active` if missing; note that Years Active update in the receipt. Continue adding the information to profiles that do not have it. If a profile already has only part of the selected details, preserve those details and add only the missing ones, reporting the profile under **Added**. Do not create duplicate entries.

**A matching year alone never makes information a duplicate**, whether that year appears in `years_active`, the destination table, or both. Compare the category-specific information below, across all years where specified:

| Category        | Details used to identify existing information                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Levels          | Level name across all years and outcomes; keep the existing version                                  |
| Staff titles    | Selected existing Staff title                                                                        |
| Honors          | Selected honor identity/name                                                                         |
| Drill           | Team                                                                                                 |
| Drum            | Instrument (`drum_played` in the user's terminology; currently stored in the period's `drums` array) |
| PBE             | Bible book and each region/placement pair                                                            |
| TLT             | Operation across all years; add only operations not previously recorded                              |
| Red Zone Events | Event, event/evaluation name where applicable, and placement                                         |

For example, a profile with `2026-27` in Years Active and Snare recorded for that year can still receive Bass for `2026-27`. Preserve Snare, add Bass to that year's drum history, and keep only one `2026-27` entry in Years Active.

If distinct information conflicts with an existing record under the schema's uniqueness rules (for example, another placement for an event allowing only one result per person/year), keep the existing value and report **Not added** with the reason. Other recipients continue.

`add_to_records(p_ids integer[], p_year text, p_entry jsonb)` returns one receipt item per unique recipient: `id`, `name`, `status` (`added`, `already`, or `error`), `year_added`, and an error `reason` when applicable. It is a security-invoker RPC restricted to authenticated users. Profiles are locked in ID order; each recipient's work runs in a subtransaction so a failure rolls back both their category change and Years Active update. A successful batch commits all successful recipients together. Existing detail containment makes retries safe without inventing new history entries.

`20260915180000_simplify_history_additions.sql` removes the role argument and limits the current-Pathfinder exclusion to Staff titles. For PBE, the backend reads and merges every book configured for the selected year regardless of a submitted subset. Years with no configured books produce a clear error and no additions.

## Future rollover

Automatic rollover is not implemented. A future role-aware registration archive must preserve outgoing status, current_title and period before starting a new season. Do not infer earned levels from current titles or infer operation/result dates from current registration. Birthday and Notes remain person-level fields rather than duplicated annual data.

## Shared year search

The **Years** control now applies to Levels, Extracurricular, and Red Zone Events together. Category dropdowns contain only the names and their outcome/team/instrument/operation/placement choices, never years. For example, Years = 2023-24, Levels = Basic or Advanced Friend, and Extracurricular = Snare or Teaching finds people with either selected Friend outcome AND either activity detail, each recorded in 2023-24. Multiple years match any selected year. Without years, the selected categories search all history. With only years selected, browse participation years. Calendar-year selections retain adjacent-period matching. Unknown level years cannot match a specific year.

The general Search Honors filter remains a placeholder; its future filtering must use shared years and within-category OR behavior. Add to Record honor lookup and profile honor display are implemented separately.

Category headings and the surrounding group area select the broad level/activity/event option. Inner buttons select specific outcomes or details; there is no separate Any button.

### Removal of historical role columns

`20260915190000_remove_history_role.sql` removes `history_role` from all 15 activity, event, and earned-honor tables and updates the batch RPC. It keeps original rows in the private, API-inaccessible `history_role_removal_backup` table. Activity rows merge by member (and team for Drill), retaining all years and details; identical honors and event results collapse. Differing legacy placements remain separate results, so event uniqueness includes placement. The Add to Record RPC still rejects a new conflicting placement. Honors show only their name and year.

### PBE region and placement search

Under Extracurricular ? PBE, a region dropdown offers Area, State, Union, and Divisional. Each region shows Any placement and the four placement buttons; selections become removable bubbles. Multiple selected placements or regions combine with OR, and the shared Years filter matches the region/placement within that same recorded year. PBE without a region still finds all PBE participation, including older books-only entries. Search has no prerequisite-region selection rule. `20260915220000_pbe_search_results.sql` extends the search view while preserving existing status/title ranking and access rules.

### Category-specific duplicate rules

`20260915230000_history_duplicate_rules.sql` applies these rules to Add to Record under the existing per-profile lock:

- Pathfinder levels: one earned version of each level name. A matching name in any year (including unknown year), with any outcome, reports Already had this information and preserves the existing entry.
- Drill: different teams may share a year; the same team/year is skipped. A team may recur in a different year.
- Drum: different instruments may share a year; the same instrument/year is skipped. An instrument may recur in a different year.
- TLT: multiple operations may share a year, but an operation already present in any year is skipped. Mixed submissions add only unseen operations, with a receipt note listing those skipped.
- Entirely duplicate level or TLT submissions do not add a new Years Active entry. Other categories retain their existing Years Active behavior. Existing historical rows are not rewritten by this migration.

### Unknown documentation years

`20260916000000_unknown_history_years.sql` allows Add to Record to use **Unknown** for every category. The RPC receives `p_year: null`; historical JSON entries store `year: null`, Drill years may include JSON null, and event/honor date columns allow SQL null. Unique keys and duplicate checks treat unknown dates consistently. Current registration and Years Active continue to require actual years; unknown additions never append to Years Active.

PBE with an unknown year stores no automatically inferred Bible books (`books: []`), but can store region placements. Existing catalog rules remain in force for known books and years. The form explains that books cannot be determined without a year.

Each profile section (levels, staff titles, activities, event results, and honors) places undated entries last, labels them **Unknown**, and inserts a margin before them when dated entries exist. General searches without a year still find unknown-year participation; searches for a specific year do not match undated entries. Existing once-per-member level and TLT rules also apply to unknown-year entries.

## Editing existing profiles

`20260916010000_edit_profile.sql` originally added authenticated, security-invoker RPCs `get_profile_for_edit(p_id)` and `update_profile(p_id, p_original, p_profile)`. The editor uses ordinary labeled fields for personal details and Notes, current registration, levels, Staff history, Drill, Drums, PBE books/results, TLT, Red Zone results, and earned honors. History sections support additional entries; ordinary classes use their visible outcome controls, while Master Guide has a dedicated Add button when unrecorded. Existing row identities, ownership, and audit fields cannot be changed, and permanent member profiles cannot be deleted through this RPC. History entries can be removed; registration removal was subsequently prohibited by the September 16 preservation migration. New rows contain editable fields only; their ownership and identities are assigned by the database.

Save Changes in the editor header opens a receipt grouped into Added, Updated, and Removed, with before/after details. Cancel replaces Close in the editor header. The receipt has an untimed Confirm button and Back to Edit; only Confirm submits. While saving, repeat submissions and closing are blocked. Success closes the editor and reloads the original profile popup and search results. Errors retain the draft. Cancel discards the draft.

The save locks the profile and existing related rows, compares the original snapshot with the current database snapshot, and updates only changed rows through a fixed table/column allowlist. Existing constraints and RLS remain in force. All updates are in one transaction: an invalid field rolls back every change. A stale snapshot is rejected with instructions to reopen the editor. No existing records are rewritten by the migration, and anonymous callers cannot execute either RPC.

`20260916020000_edit_profile_additions.sql` extends the atomic editor save to insert new history rows and a missing current registration. Staff/Drums/PBE/TLT entries append inside their member-level history arrays. Extra Drill instances with the same team merge their years into that team's stored row. All additions retain the existing ownership checks, RLS, constraints, and stale-snapshot checks; any invalid addition rolls back the entire save.

The editor displays all eight classes by name. Missing outcomes display N/A without creating placeholder database entries; selecting N/A removes that particular level entry. Multiple recorded entries for a class remain individually editable. Year selectors offer 2010-11 through the current calendar year's club period, plus Unknown for nullable history, and preserve any existing older value. Current Registration is below Notes and above Levels. Entry fieldsets retain their boundaries without numbered headings.

PBE books are read-only in the editor and derive from the chosen year. On saving a changed PBE section, the server derives every entry's books from `pbe_year_books`; submitted book lists cannot override the catalog. Unknown years have no books. Each history section can add a new instance without leaving the editor.

`20260916030000_edit_profile_removals.sql` allows the atomic editor save to remove registration and history rows omitted from the reviewed snapshot. Direct table DELETE remains denied. Only `update_profile` uses narrowly scoped security-definer privileges for the reviewed save, explicitly requiring an authenticated editor identity before accessing data. Permanent `pathfinders` rows and catalogs remain protected. The RPC still validates ownership, row identities, the full original snapshot, and all updated/added data. Deletes occur before updates within a table, and all changes roll back together if any operation fails.

Each existing history instance has an X in its top-right corner. Removing the last Staff/Drums/PBE/TLT history entry removes the enclosing stored detail row. Level sections remain visible for all eight classes; they have no Add buttons, and removing an outcome resets that class to N/A. Removals stay in the draft until the user confirms the receipt. Returning from the receipt preserves the draft, and cancelling the editor discards all proposed changes. A successful save returns to the refreshed profile popup.

`20260916040000_preserve_current_registration.sql` requires exactly one Current Registration row in a profile save and prevents removing/replacing its stored identity. The editor has no X for Current Registration. If registration was already absent, the editor supplies an editable Not Active registration for `current_club_year()` and includes it in the save receipt. No existing database records are rewritten by the migration.

PBE receipt descriptions omit Bible Books and show the year and regional results. Automatic book selection and storage remain unchanged. Red Zone Events in the read-only profile use the same year/detail lists as the other history sections, retaining event names, named evaluations, placements, newest-first ordering, and Unknown entries last.

Master Guide appears after the eight ordinary classes in the Levels editor. Add Master Guide creates an Unknown-year draft entry, whose year can be changed; no Outcome field is rendered. Existing migrated Master Guide entries remain individually editable/removable. Add to Record treats the achievement as already present once its name exists in any year, preserving all existing dates.
