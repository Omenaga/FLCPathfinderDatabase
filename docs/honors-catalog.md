# Pathfinder honors catalog

The integrated catalog contains **602 honors: 575 NAD-listed and 27 Florida Conference honors**, plus **15 Master Award entries** in a separate `master_awards` section. The September 18, 2026 schema-only migration adds `category`, `skill_level`, and `year` to the existing `honors` table. The subsequent `20260918010000_honors_integration.sql` migration imports all 617 entries, normalizes their display categories, and installs Master Award requirement tables, eligibility functions, and earned-honor search projection.

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

Thirty honors have unknown introduction years. Twenty-two Florida honors do not publish a skill level, including on their individual wiki pages; those values are null rather than invented. Every populated skill level must be 1, 2, or 3. The JSON snapshot retains source category **Regional** for Florida and its Florida `scope`. Imported database categories use **Florida**, **Arts & Crafts**, **Health & Science**, **Outreach**, and the other agreed display labels.

Duplicate source names receive an introduction-year suffix on **each** edition. The catalog contains Scrapbooking (2004), Scrapbooking (Unknown), Scrapbooking - Advanced (2004), and Scrapbooking - Advanced (Unknown). The Unknown editions are Florida's variants, with skill levels 2 and 3 respectively. Same-name/same-year editions, if added later, additionally need a scope label to keep their names unique. The generator rejects duplicate display names and missing year suffixes.

## Applying and maintaining

### Master Awards

The display category is **Master Award**, replacing Masters. The [wiki index](https://wiki.pathfindersonline.org/w/AY_Honors/Masters/en) identifies 15 current NAD awards. All 15 linked requirement lists were retrieved on September 18, 2026 and captured in `honors.json` under `master_awards`; awards explicitly unavailable in NAD and the retired Witnessing award are excluded.

Each award reserves a catalog entry with a total of seven and explicit requirement groups. Health, Naturalist, Zoology, Family/Origins/Heritage, and Spiritual Growth/Ministries require specific distributions among groups. The [schema notes](database-schema.md#master-award-catalog-and-requirements) summarize those distributions. The snapshot retains each group's source honor name, edition URL, year, and matched catalog name. Club policy accepts an existing NAD counterpart when a requirement links to another division or GC edition. The September 18 counterpart migration resolves 15 references (12 source editions) to their existing NAD catalog identities, including the source-linked Making Pizza / Pizza Maker naming difference. The original source URL and introduction year remain intact; the JSON snapshot records the basis for each substitution. Unmatched references without an identified counterpart remain null and marked `needs_review`. This matters because some source tables include regional alternatives despite the award itself being available in NAD.

The current Family/Origins/Heritage page lists three Heritage choices and requires two, plus five additional honors. Zoology describes some lists as examples. Notes preserve these details and regional variations for future review. Missing lists can later use empty groups and a pending-manual-input status while keeping the award entry. Unknown award skill levels and introduction years remain null.

The integration imports 451 source requirement references. After the NAD counterpart migration, 435 are mapped and 16 remain unresolved. `master_awards`, `master_award_groups`, and `master_award_honors` preserve the source rules. Eligibility only counts resolved, distinct ordinary honors and satisfies every group quota; sufficient known choices can establish eligibility even when other alternatives remain unresolved. Earned awards use explicit `honors_earned` records and never arise automatically from eligibility.

### Deployment

Apply the complete migration history through the normal workflow. `20260918000000_honors_columns.sql` prepares metadata; `20260918010000_honors_integration.sql` imports the catalog and installs requirement relationships and lookup functions; `20260918020000_nad_master_award_counterparts.sql` applies the club-approved NAD substitutions and refreshes requirement review statuses. The historical `import-honors.sql` file is the earlier, unnormalized 602-honor staging artifact; do not apply it over the integrated catalog.

The import upserts by unique catalog name and preserves IDs and earned references. Unmatched legacy rows remain; ambiguous unqualified Scrapbooking rows are not silently assigned to an edition. Category labels and the `is_master_award` flag drive the grouped picker and separate award display.

`node scripts/generate-honors-integration.mjs` originally generated the integration migration from `honors.json` and `honors-integration-schema.sql`. After deployment, leave the applied migration unchanged and use a new dated migration for catalog or requirement updates. The older `generate-honors-migration.mjs` reproduces only the historical regular-honor staging file.

### Application behavior

`HonorSelect` performs debounced, abortable lookups only for nonempty search text, with up to 50 results and a refinement message. Category headings contain honor-name bubbles, in the agreed category order. Search uses multiple selected IDs; add/edit select one catalog entry per documentation entry and include Master Awards. Empty search text does not clear existing selections.

The Honors dialog lists all ordinary earned honors alphabetically with completion periods (Unknown when missing), then a spaced Master Award section with earned years or Eligible ? not yet earned. Server-calculated eligibility respects group quotas without double-counting an honor; identified NAD counterparts count under club policy, while source-specific substitutions without an identified counterpart remain subject to manual review. Multiple source editions mapped to one NAD honor still contribute only one distinct honor.

The [Making Pizza source page](https://wiki.pathfindersonline.org/w/AY_Honors/Making_Pizza) explicitly cross-links to Pizza Maker; this supports that differently named counterpart. Other substitutions resolve same-name GC/SAD/SPD editions to the NAD-listed honor already in the catalog. Different introduction years remain separate catalog identities; this rule changes requirement eligibility links, not the underlying honor editions.
