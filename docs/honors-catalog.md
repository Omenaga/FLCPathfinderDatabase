# Pathfinder honors catalog

The prepared catalog contains **602 honors: 575 NAD-listed and 27 Florida Conference honors**, plus **15 planned Master Award entries** in a separate `master_awards` section. The September 18, 2026 schema-only migration adds `category`, `skill_level`, and `year` to the existing `honors` table. The catalog import is staged separately and has not been applied. Once imported, the existing honor picker can read the regular honor entries without a UI change. Master Award relationships remain schema planning only.

## Sources and scope

- [Club Ministries NAD catalog](https://www.clubministries.org/pathfinders/pathfinder-honors/): 548 source rows.
- [Wiki main AY Honors catalog](https://wiki.pathfindersonline.org/w/AY_Honors): 567 source rows, approved by NAD or General Conference.
- [Wiki Florida Conference list](https://wiki.pathfindersonline.org/w/AY_Honors/Regional#Florida_Conference): 25 entries, with their individual pages checked.
- [Florida Conference requirements](https://floridaconference.com/florida-honors-requirements/): also lists the two Florida Scrapbooking editions missing from the wiki's Florida index.

Only the main NAD/GC catalog, entries explicitly listed by Club Ministries, and Florida honors are included. Other division/conference catalogs are excluded. An honor explicitly listed by Club Ministries is included even when its originating authority is another division (for example, Cybersecurity (SSD)); this does not import that division's entire catalog.

All source URLs and source names are retained in [the reviewed snapshot](../supabase/catalogs/honors.json). Names with accents are matched by decoded wiki URL, not spelling alone. Common entries have matching skill levels across the two main lists. Wiki metadata supplies the introduction year; Club Ministries supplies category and skill level for its additional entries. The linked wiki regional indexes supply years for those additions. The Dams & Hydroelectricity and Grasslands pilot pages both specify 2022; they are included because Club Ministries lists them.

Four same-name/same-year GC alternatives (Health and Healing, Snowshoeing - Advanced, Video, and Welding) are omitted in favor of the NAD versions, as requested. Distinct introduction years are never merged.

## Metadata and edition names

`year` is an integer introduction year, with no current-year or club-season restriction. SQL null represents **Unknown**. It does not change `honors_earned.year_earned`, which remains the member's earned club season.

Thirty honors have unknown introduction years. Twenty-two Florida honors do not publish a skill level, including on their individual wiki pages; those values are null rather than invented. Every populated skill level must be 1, 2, or 3. Florida categories remain **Regional**, matching the wiki; the snapshot's `scope` distinguishes Florida provenance without adding an unrequested database column.

Duplicate source names receive an introduction-year suffix on **each** edition. The catalog contains Scrapbooking (2004), Scrapbooking (Unknown), Scrapbooking - Advanced (2004), and Scrapbooking - Advanced (Unknown). The Unknown editions are Florida's variants, with skill levels 2 and 3 respectively. Same-name/same-year editions, if added later, additionally need a scope label to keep their names unique. The generator rejects duplicate display names and missing year suffixes.

## Applying and maintaining

### Master Award planning

The display category is **Master Award**, replacing Masters. The [wiki index](https://wiki.pathfindersonline.org/w/AY_Honors/Masters/en) identifies 15 current NAD awards. All 15 linked requirement lists were retrieved on September 18, 2026 and captured in `honors.json` under `master_awards`; awards explicitly unavailable in NAD and the retired Witnessing award are excluded.

Each award reserves a catalog entry with a total of seven and explicit requirement groups. Health, Naturalist, Zoology, Family/Origins/Heritage, and Spiritual Growth/Ministries require specific distributions among groups. The [schema notes](database-schema.md#planned-master-award-catalog-and-requirements) summarize those distributions. The snapshot retains each group's source honor name, edition URL, year, and matched catalog name. Unmatched references remain null and marked `needs_review`; they are not silently replaced by similarly named NAD honors. This matters because some source tables include regional alternatives despite the award itself being available in NAD.

The current Family/Origins/Heritage page lists three Heritage choices and requires two, plus five additional honors. Zoology describes some lists as examples. Notes preserve these details and regional variations for future review. Missing lists can later use empty groups and a pending-manual-input status while keeping the award entry. Unknown award skill levels and introduction years remain null.

The data-only SQL generator currently imports only the 602 regular honors. It deliberately leaves the separate Master Award planning section for a later implementation with requirement relationships; no awards or requirement links have been applied to the live database.

### Deployment

Apply `supabase/migrations/20260918000000_honors_columns.sql` through the normal migration workflow to prepare the table. The data-only import is staged at `supabase/catalogs/import-honors.sql`, outside the migration directory, so `db push` does not import honors yet. When the catalog is ready to deploy, add that SQL as a new dated migration. `seed.sql` remains empty of member data.

The staged import upserts by the existing unique name and preserves IDs and all earned-honor references. Unmatched legacy rows remain, with nullable metadata. An existing unqualified Scrapbooking row remains untouched because its edition cannot be inferred safely; review such legacy rows before manually assigning an edition.

`node scripts/generate-honors-migration.mjs` reproduces the staged data-only import from the reviewed JSON snapshot. It does not rewrite the schema migration. Once a data import is deployed as a migration, use a new migration filename for future catalog changes. Public source snapshots contain factual catalog metadata only, not honor requirements or member information.
