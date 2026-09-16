// Read-only member overview. Re-fetch after an edit so both this dialog and search results stay current.

import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import HistoryRecords from './HistoryRecords'
import ProfileNotes from './ProfileNotes'
import EditProfile from './EditProfile'
import HonorsOverlay from './HonorsOverlay'
import { message } from '../../lib/errors'
import { statusLabel } from '../../lib/format'
import { getPathfinder, ACHIEVEMENTS, type PathfinderDetails } from '../../lib/pathfinders'

export default function ProfileOverlay({
  id,
  onClose,
  onUpdated,
}: {
  id: number
  onClose: () => void
  onUpdated: () => void
}) {
  const [details, setDetails] = useState<PathfinderDetails | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [honorsOpen, setHonorsOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  // Load on member changes and retries; abort when the dialog closes to ignore late responses.
  useEffect(() => {
    const controller = new AbortController()
    getPathfinder(id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setDetails(data)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error))
      })
    return () => controller.abort()
  }, [id, attempt])
  // Deduplicate display years without modifying the fetched record.
  const years = [...new Set(details?.member.years_active ?? [])].sort()
  // Sort by year, then class order; the sentinel places unknown dates after recorded years.
  const levels = [...(details?.member.levels ?? [])].sort(
    (a, b) =>
      (a.year ?? '9999').localeCompare(b.year ?? '9999') ||
      ACHIEVEMENTS.indexOf(a.name as (typeof ACHIEVEMENTS)[number]) -
        ACHIEVEMENTS.indexOf(b.name as (typeof ACHIEVEMENTS)[number]),
  )
  const birthday = details?.member.birth_date
  return (
    <Modal
      title="Member profile"
      onClose={onClose}
      headerActions={
        details && (
          <button type="button" onClick={() => setEditing(true)}>
            Edit Profile
          </button>
        )
      }
      header={
        details && (
          <div className="profile-heading">
            <h2>
              {[details.member.first_name, details.member.last_name].filter(Boolean).join(' ')}
            </h2>
            <span className="profile-status">{statusLabel(details.status)}</span>
          </div>
        )
      }
    >
      {error ? (
        <>
          <p role="alert" className="error">
            {error}
          </p>
          <button
            onClick={() => {
              setError('')
              setDetails(null)
              setAttempt((value) => value + 1)
            }}
          >
            Try again
          </button>
        </>
      ) : !details ? (
        <p role="status">Loading profile...</p>
      ) : (
        <>
          <section className="profile-summary">
            <h3>Birthday</h3>
            <p>
              {birthday
                ? `${birthday.slice(5, 7)}/${birthday.slice(8, 10)}/${birthday.slice(0, 4)}`
                : 'Not recorded'}
            </p>
          </section>
          <section className="profile-summary">
            <h3>Years Active</h3>
            <p>{years.join(', ') || 'No years recorded'}</p>
          </section>
          {/* Render Pathfinder and Staff histories separately, independent of current registration. */}
          {details.roles.map((group) => (
            <section
              className="profile-role"
              key={group.role}
              aria-label={`${group.role === 'staff' ? 'Staff' : 'Pathfinder'} history`}
            >
              <h3 className="role-heading">
                {group.role === 'staff' ? 'Staff History' : 'Pathfinder History'}
              </h3>
              {group.role === 'pathfinder' ? (
                <section className="profile-summary">
                  <h4>Levels</h4>
                  {levels.length ? (
                    <HistoryRecords
                      records={levels.map((level) => ({
                        year: level.year,
                        detail:
                          level.name === 'Master Guide'
                            ? level.name
                            : `${level.name} (${statusLabel(level.outcome ?? null)})`,
                      }))}
                    />
                  ) : (
                    <p>No levels recorded</p>
                  )}
                </section>
              ) : (
                <section className="profile-summary">
                  <h4>Years and Titles</h4>
                  {details.staffHistory.length ? (
                    <HistoryRecords
                      records={details.staffHistory.map((record) => ({
                        year: record.year,
                        detail: record.titles.join(', ') || 'Title not recorded',
                      }))}
                    />
                  ) : (
                    <p>No staff years or titles recorded</p>
                  )}
                </section>
              )}
              {group.activities.map((activity) => (
                <section className="profile-activity" key={activity.name}>
                  <h4>{activity.name === 'Drums' ? 'Drum' : activity.name}</h4>
                  <HistoryRecords
                    records={activity.records.flatMap((record) =>
                      record.years.map((year) => ({
                        year,
                        detail: record.detail || 'Details not recorded',
                      })),
                    )}
                  />
                </section>
              ))}
              {group.events.length > 0 && (
                <section className="profile-activity">
                  <h4>Red Zone Events</h4>
                  {group.events.map((event) => (
                    <section className="profile-event" key={event.name} aria-label={event.name}>
                      <h5>{event.name}</h5>
                      <HistoryRecords
                        newestFirst
                        records={event.records.map((record) => ({
                          year: record.year,
                          detail: [record.name, record.placement].filter(Boolean).join(' - '),
                        }))}
                      />
                    </section>
                  ))}
                </section>
              )}
            </section>
          ))}
          <section className="profile-honors">
            <h3>Honors</h3>
            <button className="secondary" onClick={() => setHonorsOpen(true)}>
              View Honors
            </button>
          </section>
          <ProfileNotes notes={details.member.notes ?? ''} />
        </>
      )}
      {/* The editor is a nested dialog; successful saves reload both this profile and its parent results. */}
      {editing && (
        <EditProfile
          id={id}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            setDetails(null)
            setError('')
            setAttempt((value) => value + 1)
            onUpdated()
          }}
        />
      )}
      {honorsOpen && <HonorsOverlay id={id} onClose={() => setHonorsOpen(false)} />}
    </Modal>
  )
}
