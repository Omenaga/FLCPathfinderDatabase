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
| `levels`        | JSON    | Levels earned — see [Levels](#levels-options) for valid options |

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

### 4. `extracurriculars` (Activity Master List)
Lookup table for all possible extracurricular activities.  
See [Extracurricular Names](#extracurricular-names-options) for valid options.

| Column  | Type   | Description                            |
|---------|--------|----------------------------------------|
| `id`    | Integer | Primary key                          |
| `name`  | String | Activity name — e.g. "Drill", "Drums" |

### 5. `pathfinder_extracurriculars` (Relationship)
Many-to-many link between pathfinders and extracurriculars.

| Column               | Type    | Description                         |
|----------------------|---------|-------------------------------------|
| `pathfinder_id`      | Integer | FK → `pathfinders.id`               |
| `extracurricular_id` | Integer | FK → `extracurriculars.id`          |

---

## Sub-Activity Tracking Tables

### 6. `drum_corps` (Drum Participation)
Tracks years and instrument played in drum corps.  
See [Drums Played Options](#drums-played-options) for valid instruments.

| Column          | Type    | Description / Example                              |
|-----------------|---------|----------------------------------------------------|
| `id`            | Integer | Primary key                                        |
| `pathfinder_id` | Integer | FK → `pathfinders.id`                              |
| `years`         | JSON    | Array of school years — e.g. `["2024-2025", "2025-2026"]` |
| `drum_played`   | String  | Instrument — see options below                     |

### 7. `pbe` (Pathfinder Bible Experience)
Tracks PBE years and linked Bible books.

| Column          | Type    | Description / Example                              |
|-----------------|---------|----------------------------------------------------|
| `id`            | Integer | Primary key                                        |
| `pathfinder_id` | Integer | FK → `pathfinders.id`                              |
| `years`         | JSON    | Array of school years — e.g. `["2024-2025", "2025-2026"]` |
| `bible_book`    | String  | Linked Bible book — e.g. "Exodus", "Luke"          |

### 8. `tlt` (Teaching Leadership Training)
Tracks TLT years and linked titles.  
See [TLT Titles Options](#tlt-titles-options) for valid titles.

| Column          | Type    | Description / Example                              |
|-----------------|---------|----------------------------------------------------|
| `id`            | Integer | Primary key                                        |
| `pathfinder_id` | Integer | FK → `pathfinders.id`                              |
| `years`         | JSON    | Array of school years — e.g. `["2024-2025", "2025-2026"]` |
| `title`         | String  | TLT title — see options below                      |

---

## Special Event Tables

### 9. `red_zone_participation` (Main Participation Table)
Main table linking Pathfinders and years to their Red Zone participation records.  
See [Red Zone Participation Links](#red-zone-participation-links) for relationship info.

| Column         | Type    | Description / Example            |
|----------------|---------|----------------------------------|
| `id`           | Integer | Primary key                      |
| `pathfinder_id`| Integer | FK → `pathfinders.id`            |
| `year`         | Integer | Year participated — e.g. 2013, 2024 |

### 10. `red_zone_drill_performance`
Tracks placement results for Drill at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement achieved — e.g. "First Place", "Second Place" |

### 11. `red_zone_drum_performance`
Tracks placement results for Drums at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement achieved — e.g. "First Place", "Second Place" |

### 12. `red_zone_honor_evaluations`
Tracks placement results for Honor Evaluations (by name) at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `name`         | String  | Name of evaluation — e.g. "Junior", "Senior" |
| `placement`    | String  | Placement achieved — e.g. "First Place", "Second Place" |

### 13. `red_zone_bible_events`
Tracks placement results for Bible Events (by name) at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `name`         | String  | Name of event — e.g. "Bible Ball", "Bible Quiz" |
| `placement`    | String  | Placement achieved — e.g. "First Place", "Second Place" |

### 14. `red_zone_knots`
Tracks placement results for Knots at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement achieved — e.g. "First Place", "Second Place" |

### 15. `red_zone_tents`
Tracks placement results for Tents at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement achieved — e.g. "First Place", "Second Place" |

### 16. `red_zone_jump_rope`
Tracks placement results for Jump Rope at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement achieved — e.g. "First Place", "Second Place" |

### 17. `red_zone_archery`
Tracks placement results for Archery at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement achieved — e.g. "First Place", "Second Place" |

### 18. `red_zone_lashing`
Tracks placement results for Lashing at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement achieved — e.g. "First Place", "Second Place" |

### 19. `red_zone_burning_twine`
Tracks placement results for Burning Twine at Red Zone.

| Column         | Type    | Description / Example                    |
|----------------|---------|------------------------------------------|
| `id`           | Integer | Primary key                              |
| `pathfinder_id`| Integer | FK → `pathfinders.id`                    |
| `year`         | Integer | Year participated — e.g. 2013, 2024      |
| `placement`    | String  | Placement achieved — e.g. "First Place", "Second Place" |

---

## Column Option Definitions

### Levels Options
Valid values for the `levels` JSON array in the `pathfinders` table.

1. Friend
2. Companion
3. Explorer
4. Ranger
5. Voyager
6. Guide
7. Pioneer
8. Navigator

### Extracurricular Names Options
Valid values for the `name` column in the `extracurriculars` table.  
Each links to its respective Sub-Activity Tracking Table:

1. **Drill** → [`red_zone_drill_performance`](#10-red_zone_drill_performance)
2. **Drums** → [`drum_corps`](#6-drum_corps), [`red_zone_drum_performance`](#11-red_zone_drum_performance)
3. **PBE** → [`pbe`](#7-pbe-pathfinder-bible-experience)
4. **TLT** → [`tlt`](#8-tlt-teaching-leadership-training)

### Drums Played Options
Valid values for the `drum_played` column in the `drum_corps` table.

1. Snare
2. Quad
3. Bass
4. Tenor
5. Cymbol

### TLT Titles Options
Valid values for the `title` column in the `tlt` table.

1. Administrative
2. Outreach
3. Teaching
4. Activity
5. Records
6. Counseling

### Red Zone Participation Links
The `red_zone_participation` table should establish foreign-key relationships with all of the other Special Event tables (tables 10–19 above). Each of those tables shares a composite key of `pathfinder_id` + `year` that references back into `red_zone_participation`, ensuring every Red Zone achievement record is tied to a documented instance of participation for that member in that year.
