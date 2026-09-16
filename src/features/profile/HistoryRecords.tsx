// Display dated history in order, always placing unknown years after known years.

import type { ReactNode } from 'react'

export default function HistoryRecords({
  records,
  newestFirst = false,
}: {
  records: { year: string | null; detail: ReactNode }[]
  newestFirst?: boolean
}) {
  // Copy before sorting to preserve the caller's order. Null years stay last in either date direction.
  const sorted = [...records].sort((a, b) =>
    a.year === null
      ? b.year === null
        ? 0
        : 1
      : b.year === null
        ? -1
        : newestFirst
          ? b.year.localeCompare(a.year)
          : a.year.localeCompare(b.year),
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
