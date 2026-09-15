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
| `years_active` | jsonb | Unique participation ranges, e.g. `["2023-24"]`; Add Record initializes this with Current Year for every status |
| `levels` | jsonb | Level/outcome/year entries described below |
| `birth_date` | date, nullable | Birthday; display MM/DD/YYYY without timezone conversion |
| `notes` | text, nullable | Multiline plain text; editable through Save Notes in the profile |
| `creation_request_id` | uuid, nullable, unique | Internal Add Record request identifier; prevents duplicate creation when the same form is retried |
| `created_at`, `updated_at` | timestamptz | Creation and automatically updated modification time |

The old name, graduated, extracurriculars, and red_zone_participation columns are removed. Full display/search names are derived from first and last names. Historical participation comes from detail tables.

### `current_data`

At most one row per person. `current_club_year()` selects `2026-27`; this changes only through an intentional rollover, not automatically in January.

| Column | Type | Meaning |
|---|---|---|
| `pathfinder_id` | integer PK/FK | References the permanent person |
| `school_year` | text | Required `YYYY-YY` range; defaults to current_club_year() for new rows; internal club-season selection |
| `status` | text | Pathfinder (`pathfinder`), Staff (`staff`), Parent (`parent`), Not Active (`not_active`); default Not Active |
| `current_title` | jsonb, nullable | Unique array of Pathfinder classes or Staff titles, validated against status |
| `current_activities` | jsonb | Staff: `["N/A"]` automatically; otherwise a unique array of Drill, Drums, PBE, TLT |
| `created_at`, `updated_at` | timestamptz | Maintained timestamps |

Grade is removed. For Pathfinder, each current_title entry must be one of the eight level names. For Staff, each title must come from `staff_titles`; the catalog is seeded with the titles below. Multiple titles/classes may be stored, e.g. `["Club Director", "Drill Instructor"]` for Staff. Unknown titles remain null or an empty array. Staff activities are normalized to `["N/A"]`; moving away from Staff clears that marker to `[]` unless replacement activities are supplied. Original current data is retained in administrator-only `private.current_title_json_backup`. Parent/Not Active must have null titles. Changing status requires a compatible title or clearing it. Current classes do not imply earned achievements.

### `staff_titles` and `staff_history`

`staff_titles(title text primary key)` holds allowed staff titles; authenticated users may read the catalog, and administrators configure it. Referenced titles cannot be removed in a way that invalidates saved current or historical data. No placeholder title is stored.

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
31. Master Guide
32. Junior Staff

`staff_history` contains `id` (identity primary key), `pathfinder_id` (unique FK), and `history` (nonempty JSON array). One row per member, with one entry per unique period and multiple titles allowed per period. Titles come from `staff_titles` but are not restricted to particular years. Empty title arrays preserve participation with an unknown title. Validation and catalog-protection triggers prevent invalid references. Staff years are included in Years Active search.

```json
[
  { "year": "2023-24", "titles": ["Friend Counselor", "Drill Instructor"] },
  { "year": "2024-25", "titles": [] }
]
```

## Year ranges and migration

All stored participation/achievement years use consecutive `YYYY-YY` ranges, e.g. `2012-13`, `2023-24`, `2026-27`. The four-digit start year must be at least 1900; the suffix must be the last two digits of the following year. `1999-00` is valid. Birthday is still a full date, and audit timestamps remain timestamps.

This applies to Years Active, levels, current school_year, Drill years, Drums/PBE/TLT history, all RZE results, honors earned, staff_history, and year-linked catalogs. Sort by the full starting year. Duplicate ranges in a single years array are rejected.

The user-approved migration maps standalone 2024 to `2023-24`; long ranges such as `2023-2024` shorten to `2023-24`. Existing undated levels retain null years and display Year unknown. Existing history was classified as Pathfinder history; current status does not reclassify the past. Unknown Drill teams remain null. The existing person's first/last names and Staff status were explicitly confirmed before conversion.

`private.member_revision_backup` retains the pre-migration records for administrator review and is inaccessible to browser users. Migration history remains intact; future changes use new migrations. The staff/drum history migration preserves period/detail associations and retains original rows in administrator-only `private.staff_drum_history_backup`.

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
| `drum_corps` | id identity PK, history jsonb | One row per member/role; each range paired with its instruments |
| `pbe` | id identity PK, history jsonb | One row per member/role; each range paired with its books |
| `tlt` | id identity PK, history jsonb | One row per member/role; each range paired with its operations |

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
  { "year": "2021-22", "books": ["1 Kings", "Ruth"] },
  { "year": "2022-23", "books": ["John"] }
]
```

Staff/Drums/PBE/TLT histories are required nonempty arrays, with one object per unique period. Title/instrument/book/operation arrays contain unique valid strings; empty arrays preserve participation with unknown details. Do not combine multiple names into one comma-separated string.

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

The security-invoker `member_search` view returns one row per person, preserving RLS, server-side counts, and pagination. Current Data is left-joined for the selected club season. Missing current data defaults to Not Active. First and Last are separate displayed columns; the derived full name supports combined name searching. The current implementation sorts by last name, first name, and internal ID; the planned default below replaces that order.

### Planned automatic member ordering (not implemented)

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

Sort the complete matching result set on the server **before pagination**, rather than sorting only the displayed page. The Staff catalog currently has only a title key, so implementation must explicitly represent this priority order; neither alphabetical order nor table insertion order defines Staff priority. This ordering uses current registration, not earned levels or historical titles.

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
4. **Staff History**: staff_history period/title entries, and activity/RZE records explicitly marked staff.
5. **Notes**: multiline plain-text editor with Save Notes, pending/success/error states, and an unsaved-changes notice. Closing does not automatically save.

Both role sections remain identifiable, with empty messages when their summary history is unknown. Activity/event subsections without records are omitted. Current Staff status never hides past Pathfinder records. Staff titles can be supplied later without assigning guessed titles now.

The overlay preserves filters/results/pagination, supports loading/retry and mobile scrolling, prevents stale requests from rendering, and returns focus to its opener. Honors preserves the underlying profile and closes independently with Escape or Close.

## Planned Add page sections and labels (not implemented)

Keep the creation and history-addition actions in the Add area alongside Search:

- Rename the existing **Add Record** creation button to **Add New Profile**. It continues to open the new-person registration flow documented below.
- Replace the current **Edit Profiles** placeholder section with **Add to Record**, with a button of the same name. This opens the planned flow for adding information to one or more existing profiles.
- Move **Edit Profiles** into a separate, future section for changing existing data. It is not part of Add to Record, and its placement and implementation remain future work.

These are planned UI labels; existing database function names and the creation flow remain unchanged.

## Add New Profile flow (currently labeled Add Record)

The Add / Edit Profiles page includes the Add Record modal, with status-dependent choices, the configured current year, and a five-second confirmation countdown. Confirm calls `add_member_record` in Supabase and shows Record Added only after saving succeeds. Profile editing remains future work.

Add a tab alongside **Search** that opens a page for adding and, eventually, editing profiles. The initial implementation focuses on adding records; editing and any later separation into pages remain future work. An **Add Record** button on this page opens a modal form.

### Form fields

| Label | Stored field | Behavior |
|---|---|---|
| First Name | `pathfinders.first_name` | Required; trim whitespace; 1-200 characters |
| Last Name | `pathfinders.last_name` | Trim whitespace; up to 200 characters; blank allowed when unknown under the existing schema |
| Status | `current_data.status` | Select Pathfinder, Staff, Parent, or Not Active |
| Birthday | `pathfinders.birth_date` | Date input; store a date without timezone conversion; blank stores null |
| Class/Title | `current_data.current_title` | Pathfinder: one class; Staff: multiple titles allowed. Stored as an array; unknown titles may remain unselected |
| Current Year | `current_data.school_year` | Autofill from the configured `current_club_year()`; display the full range, e.g. `2026-2027`, and store `2026-27` |

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

## Planned Add to Record flow: add history to existing profiles (not implemented)

**Add to Record** adds documentation to existing profiles. This is the flow previously discussed as editing; changing or removing existing data belongs to the separate future **Edit Profiles** section. The following is an initial plan and will be expanded with further requirements.

### Year and documentation choice

1. Clicking **Add to Record** opens a dialog asking **what year to document**. Choose one school-year period for the new entry, using the existing `YYYY-YY` storage format. Recipient profiles are selected after the information to add is defined.
2. Choose exactly one documentation category per entry: **Level Earned**, **Extracurricular**, **Red Zone Events**, or **Honors**.
3. Show the relevant choices and any further detail options underneath that category. The same year and documentation will be added to each selected existing profile.

| Category | Choices and dependent details | Existing storage / planning notes |
|---|---|---|
| Level Earned | Select exactly one of the eight Pathfinder classes (Friend, Companion, Explorer, Ranger, Voyager, Guide, Pioneer, Navigator), or one Staff class | Pathfinder achievements use `pathfinders.levels` with name, outcome, and year. The Staff class catalog and its storage are still to be defined; do not assume Staff classes are the same as `staff_titles`. Outcome selection for this flow remains to be specified. |
| Extracurricular | Select Drill, Drum, PBE, or TLT, then choose any applicable further details | Drill: team; Drum: instrument; PBE: book options for the selected year; TLT: operation. Use the existing activity catalogs and history tables. Whether each detail permits one or multiple selections remains to be specified. |
| Red Zone Events | Select an event, then its placement | Use the existing event tables and placements: 1st Place, 2nd Place, 3rd Place, Participation. Named events also need their event/evaluation name; the input flow for those names remains to be specified. |
| Honors | Type an honor name to search the database catalog, then select a matching honor | Plan for hundreds of honors with searchable database-backed suggestions, similar to Search. Use `honors` for the catalog and `honors_earned` for the person/year association. Honors UI integration remains unimplemented. |

### Eligibility by role

Depending on the selected documentation option, eligibility may be restricted to **Pathfinders**, **Staff**, **Parents**, or any combination of those roles. **Confirmed rule: when a Staff title is chosen, profiles whose current Status is Pathfinder must not appear as selectable options.** Other allowed-role combinations remain to be supplied; do not infer that this rule permits or excludes Parent or Not Active profiles.

The Staff-title exclusion explicitly uses current Status. For other options, the plan must still define whether eligibility uses current Status or the person's role in the documented year, and how Not Active people are handled. Existing activity, event, and honor history supports only `pathfinder` and `staff` in `history_role`; Parent history requires an explicit schema decision before implementation. Do not silently record Parent participation as another role. The relationship between the earlier Staff class choice and Staff titles remains to be clarified.

### Search and select recipient profiles

After defining the year and documentation, present a profile search similar to the existing Search feature. Users can search for existing profiles and **check/select or uncheck/deselect any number of eligible profiles** to receive that same information.

- Track selection by permanent person ID, not by name.
- Preserve checked profiles when the user changes searches, filters, or result pages, so they can gather recipients across multiple searches. Provide a visible selection count and a way to review and deselect chosen profiles.
- Apply the eligibility rules to the available recipients. If the documentation changes, revalidate the selection and identify/remove any newly ineligible recipients before confirmation.
- Require at least one eligible selected profile before enabling **Finish / Done**. This button opens the final review; it does not write records.

### Final review and submission

1. **Finish / Done** opens a final confirmation screen with a quick transcript/receipt of **what will be added and to whom**: the year, category, chosen class/title/activity/event/honor, applicable details such as outcome or placement, and every selected recipient's name. Include current Status where useful for distinguishing recipients and reviewing eligibility.
2. Allow the user to return to the preceding steps to adjust the information or recipient selection before saving.
3. The final **Confirm** button is **not timed**. Only this confirmation submits the documentation for the reviewed recipients.
4. After Confirm, the final modal shows a **loading state** while the information is being saved. Prevent repeat submission while it is pending.
5. On a save failure, show an **error state explaining why**. Preserve the proposed information and recipient selection for review or retry. Information already present on a profile is a normal skipped outcome, not a save failure, and must not stop additions to other profiles. Handling of other batch failures and retry behavior remains to be defined before implementation; the UI must not imply that unsaved entries succeeded.
6. On completion, show a final receipt listing **Added** profiles and **Already had this information** profiles, with counts for each group and the documented information. If every selected profile already had the information, show that outcome without reporting an error or claiming new additions. Close returns to the main page.

Recheck recipient eligibility on the backend when saving, including the current-Status exclusion for Staff titles, so a status change after selection cannot bypass the rule.

### Preserve existing records

New documentation must preserve all previously recorded years, achievements, activities, results, and honors. For tables that store multiple periods/details in one JSON array, adding documentation means appending or merging new entries while retaining existing values.

For each selected profile, ensure the documented year is present in **both** `pathfinders.years_active` and the relevant category's history entry. Append the year to `years_active` only if missing, retaining all previous years. Save the year with the specific information in the appropriate table/JSON history structure as well. These changes must succeed together for that profile; a failed category write must not leave only a new Years Active entry.

Check each selected profile for the proposed information in the documented year and applicable historical role. If it already has all of that category information, report **Already had this information** and still add the year to `years_active` if missing; note that Years Active update in the receipt. Continue adding the information to profiles that do not have it. If a profile already has only part of the selected details, preserve those details and add only the missing ones, reporting the profile under **Added**. Do not create duplicate entries.

**A matching year alone never makes information a duplicate**, whether that year appears in `years_active`, the destination table, or both. Within the selected year and applicable role, compare the category-specific information:

| Category | Details used to identify existing information |
|---|---|
| Levels | Level name and outcome |
| Staff titles | Selected title (Staff class mapping remains to be defined) |
| Honors | Selected honor identity/name |
| Drill | Team |
| Drum | Instrument (`drum_played` in the user's terminology; currently stored in the period's `drums` array) |
| PBE | Bible book |
| TLT | Operation |
| Red Zone Events | Event, event/evaluation name where applicable, and placement |

For example, a profile with `2026-27` in Years Active and Snare recorded for that year can still receive Bass for `2026-27`. Preserve Snare, add Bass to that year's drum history, and keep only one `2026-27` entry in Years Active.

If distinct information conflicts with an existing record under the schema's uniqueness rules (for example, another placement for an event allowing only one result per person/year/role), do not overwrite it or label it as already present; conflict handling or a schema adjustment remains to be specified. Batch transaction/retry behavior for other errors also remains to be specified.

## Future rollover

Automatic rollover is not implemented. A future role-aware registration archive must preserve outgoing status, current_title, current activities, and period before starting a new season. Do not infer earned levels from current titles or infer operation/result dates from current registration. Birthday and Notes remain person-level fields rather than duplicated annual data.


## Shared year search

The **Years** control now applies to Levels, Extracurricular, and Red Zone Events together. Category dropdowns contain only the names and their outcome/team/instrument/operation/placement choices, never years. For example, Years = 2023-24, Levels = Basic or Advanced Friend, and Extracurricular = Snare or Teaching finds people with either selected Friend outcome AND either activity detail, each recorded in 2023-24. Multiple years match any selected year. Without years, the selected categories search all history. With only years selected, browse participation years. Calendar-year selections retain adjacent-period matching. Unknown level years cannot match a specific year.

Honors is still an empty placeholder; its future implementation must use the same shared years and within-category OR behavior. No honors records are fetched or falsely matched by the placeholder today.

Category headings and the surrounding group area select the broad level/activity/event option. Inner buttons select specific outcomes or details; there is no separate Any button.
