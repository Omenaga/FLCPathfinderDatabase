import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import HistoryRecords from './HistoryRecords'
import NotesEditor from './NotesEditor'
import HonorsOverlay from './HonorsOverlay'
import { message } from '../../lib/errors'
import { statusLabel } from '../../lib/format'
import { getPathfinder, LEVELS, type PathfinderDetails } from '../../lib/pathfinders'

export default function ProfileOverlay({ id, status, onClose }: { id: number; status: string; onClose: () => void }) {
  const [details, setDetails] = useState<PathfinderDetails | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [honorsOpen, setHonorsOpen] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    getPathfinder(id, controller.signal).then(data => {
      if (!controller.signal.aborted) setDetails(data)
    }).catch(error => { if (!controller.signal.aborted) setError(message(error)) })
    return () => controller.abort()
  }, [id, attempt])
  const years = [...new Set(details?.member.years_active ?? [])].sort()
  const levels = [...(details?.member.levels ?? [])].sort((a, b) => (a.year ?? '9999').localeCompare(b.year ?? '9999') || LEVELS.indexOf(a.name as typeof LEVELS[number]) - LEVELS.indexOf(b.name as typeof LEVELS[number]))
  const birthday = details?.member.birth_date
  return <Modal title="Member profile" onClose={onClose} header={details && <div className="profile-heading"><h2>{[details.member.first_name, details.member.last_name].filter(Boolean).join(' ')}</h2><span className="profile-status">{statusLabel(status)}</span></div>}>
    {error ? <><p role="alert" className="error">{error}</p><button onClick={() => { setError(''); setDetails(null); setAttempt(value => value + 1) }}>Try again</button></> : !details ? <p role="status">Loading profile...</p> : <>
      <section className="profile-summary"><h3>Birthday</h3><p>{birthday ? `${birthday.slice(5,7)}/${birthday.slice(8,10)}/${birthday.slice(0,4)}` : 'Not recorded'}</p></section>
      <section className="profile-summary"><h3>Years Active</h3><p>{years.join(', ') || 'No years recorded'}</p></section>
      {details.roles.map(group => <section className="profile-role" key={group.role} aria-label={`${group.role === 'staff' ? 'Staff' : 'Pathfinder'} history`}>
        <h3 className="role-heading">{group.role === 'staff' ? 'Staff History' : 'Pathfinder History'}</h3>
        {group.role === 'pathfinder' ? <section className="profile-summary"><h4>Levels</h4>{levels.length ? <HistoryRecords records={levels.map(level => ({ year: level.year, detail: `${level.name} (${statusLabel(level.outcome)})` }))} /> : <p>No levels recorded</p>}</section>
        : <section className="profile-summary"><h4>Years and Titles</h4>{details.staffHistory.length ? <HistoryRecords records={details.staffHistory.map(record => ({ year: record.year, detail: record.titles.join(', ') || 'Title not recorded' }))} /> : <p>No staff years or titles recorded</p>}</section>}
        {group.activities.map(activity => <section className="profile-activity" key={activity.name}>
          <h4>{activity.name === 'Drums' ? 'Drum' : activity.name}</h4>
          <HistoryRecords records={activity.records.flatMap(record => record.years.map(year => ({ year, detail: record.detail || 'Details not recorded' })))} />
        </section>)}
        {group.events.length > 0 && <section><h4>Red Zone Events</h4><div className="profile-events">
          {group.events.map(event => <article key={event.name}><h5>{event.name}</h5><ul>{event.records.map((record, index) =>
            <li key={`${record.year}-${index}`} className={record.year === null ? 'unknown-history' : undefined}><strong>{record.year ?? 'Unknown'}</strong>{record.name && <span>{record.name}</span>}<span>{record.placement}</span></li>)}</ul></article>)}
        </div></section>}
      </section>)}
      <section className="profile-honors"><h3>Honors</h3><button className="secondary" onClick={() => setHonorsOpen(true)}>View Honors</button></section>
      <NotesEditor id={id} initialNotes={details.member.notes ?? ''} />
    </>}
    {honorsOpen && <HonorsOverlay id={id} onClose={() => setHonorsOpen(false)} />}
  </Modal>
}
