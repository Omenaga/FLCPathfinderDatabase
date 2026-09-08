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
| `levels`        | JSON    | Levels earned — e.g. `["Friends", "Companions", "Pioneer"]` |

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

| Column  | Type   | Description                     |
|---------|--------|---------------------------------|
| `id`    | Integer | Primary key                   |
| `name`  | String | Activity name — e.g. "Hiking"   |

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

| Column          | Type    | Description / Example                              |
|-----------------|---------|----------------------------------------------------|
| `id`            | Integer | Primary key                                        |
| `pathfinder_id` | Integer | FK → `pathfinders.id`                              |
| `years`         | JSON    | Array of school years — e.g. `["2024-2025", "2025-2026"]` |
| `drum_played`   | String  | Instrument — e.g. "Snare", "Bass", "Tenor"          |

---

### 7. `pbe` (Pathfinder Bible Experience)
Tracks PBE years and linked Bible books.

| Column          | Type    | Description / Example                              |
|-----------------|---------|----------------------------------------------------|
| `id`            | Integer | Primary key                                        |
| `pathfinder_id` | Integer | FK → `pathfinders.id`                              |
| `years`         | JSON    | Array of school years — e.g. `["2024-2025", "2025-2026"]` |
| `bible_book`    | String  | Linked Bible book — e.g. "Exodus", "Luke"          |

---

### 8. `tlt` (Teaching Leadership Training)
Tracks TLT years and linked titles.

| Column          | Type    | Description / Example                              |
|-----------------|---------|----------------------------------------------------|
| `id`            | Integer | Primary key                                        |
| `pathfinder_id` | Integer | FK → `pathfinders.id`                              |
| `years`         | JSON    | Array of school years — e.g. `["2024-2025", "2025-2026"]` |
| `title`         | String  | Linked TLT title — e.g. "Activities", "Counseling" |

---

## Special Event Tables

### 9. `red_zone_participation` (Main Participation Table)
Links Pathfinders and years to their Red Zone participation records.

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