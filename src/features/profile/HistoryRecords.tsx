import type { ReactNode } from 'react'

export default function HistoryRecords({ records, newestFirst = false }: { records: { year: string | null; detail: ReactNode }[]; newestFirst?: boolean }) {
  const sorted = [...records].sort((a, b) => a.year === null ? (b.year === null ? 0 : 1) : b.year === null ? -1 : (newestFirst ? b.year.localeCompare(a.year) : a.year.localeCompare(b.year)))
  return <dl className="profile-records">{sorted.map((record, index) => <div key={index} className={record.year === null ? 'unknown-history' : undefined}><dt>{record.year ?? 'Unknown'}</dt><dd>{record.detail}</dd></div>)}</dl>
}
