// Display dated history in order, always placing unknown years after known years.

export default function HistoryRecords({
  records,
}: {
  records: { year: string | null; detail: string }[]
}) {
  // Sort a copy so display ordering never changes the underlying profile data.
  const sorted = [...records].sort(
    (a, b) =>
      (a.year ?? '9999').localeCompare(b.year ?? '9999') ||
      a.detail.localeCompare(b.detail, undefined, { sensitivity: 'base' }),
  )
  return (
    <dl className="profile-records">
      {sorted.map((record, index) => (
        <div key={index} className={record.year === null ? 'unknown-history' : undefined}>
          <dt>{record.year ?? 'Unknown'}</dt>
          <dd>{record.detail}</dd>
        </div>
      ))}
    </dl>
  )
}
