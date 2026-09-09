# FLC Pathfinder Database Schema

This document describes the planned structure for the FLC Pathfinder member tracking database.

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
