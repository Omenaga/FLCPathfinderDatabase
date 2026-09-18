// Generate the integration migration from reviewed catalog data. Once deployed,
// use a new migration for future catalog changes; never rewrite applied history.
import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const catalog = JSON.parse(await readFile(new URL('supabase/catalogs/honors.json', root), 'utf8'))
const quote = (s) => (s == null ? 'null' : `'${s.replaceAll("'", "''")}'`)
const number = (n) => n ?? 'null'
const labels = {
  'Arts, Crafts and Hobbies': 'Arts & Crafts',
  'Health and Science': 'Health & Science',
  'Spiritual Growth, Outreach and Heritage': 'Outreach',
}
const honors = catalog.honors.map((h) => ({
  ...h,
  category: h.scope === 'Florida' ? 'Florida' : (labels[h.category] ?? h.category),
  is_master_award: false,
}))
const awards = catalog.master_awards.map((h) => ({ ...h, is_master_award: true }))
const entries = [...honors, ...awards]
if (new Set(entries.map((h) => h.name)).size !== entries.length)
  throw new Error('Catalog names must uniquely identify editions and awards')
const honorNames = new Set(honors.map((h) => h.name))
const statements = [
  '-- Public honor and Master Award catalogs; preserve existing IDs and member references.',
  `insert into public.honors(name,category,skill_level,year,is_master_award) values\n${entries
    .map(
      (h) =>
        `(${quote(h.name)},${quote(h.category)},${number(h.skill_level)},${number(h.year)},${h.is_master_award})`,
    )
    .join(
      ',\n',
    )}\non conflict(name) do update set category=excluded.category, skill_level=excluded.skill_level, year=excluded.year, is_master_award=excluded.is_master_award;`,
]
for (const award of awards) {
  if (award.requirement_groups.reduce((sum, g) => sum + g.required_count, 0) !== 7)
    throw new Error(`Invalid seven-honor rule: ${award.name}`)
  const awardId = `(select id from public.honors where name=${quote(award.name)})`
  statements.push(
    `insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values (${awardId},7,${quote(award.requirements_status)},${quote(award.source_url)},${quote(JSON.stringify(award.notes))}::jsonb);`,
  )
  for (const [index, group] of award.requirement_groups.entries()) {
    statements.push(
      `insert into public.master_award_groups(award_id,name,sort_order,required_count) values (${awardId},${quote(group.name)},${index + 1},${group.required_count});`,
    )
    const groupId = `(select id from public.master_award_groups where award_id=${awardId} and sort_order=${index + 1})`
    for (const honor of group.honors) {
      if (honor.catalog_name !== null && !honorNames.has(honor.catalog_name))
        throw new Error(`Unrecognized honor mapping: ${honor.catalog_name}`)
      if ((honor.catalog_name === null) !== (honor.mapping_status === 'needs_review'))
        throw new Error(`Inconsistent mapping status: ${honor.source_name}`)
      const honorId = honor.catalog_name
        ? `(select id from public.honors where name=${quote(honor.catalog_name)})`
        : 'null'
      statements.push(
        `insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values (${groupId},${quote(honor.source_url)},${quote(honor.source_name)},${number(honor.source_year)},${honorId},${quote(honor.mapping_status)});`,
      )
    }
  }
}
const schema = await readFile(
  new URL('supabase/catalogs/honors-integration-schema.sql', root),
  'utf8',
)
await writeFile(
  new URL('supabase/migrations/20260918010000_honors_integration.sql', root),
  `-- Generated from the reviewed honors catalog and honors-integration-schema.sql.\nbegin;\n\n${schema}\n\n${statements.join('\n')}\n\nnotify pgrst, 'reload schema';\ncommit;\n`,
)
console.log(
  `Generated ${honors.length} honors and ${awards.length} Master Awards with requirements.`,
)
