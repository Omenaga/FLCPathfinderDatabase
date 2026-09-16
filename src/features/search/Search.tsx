// Search screen and reusable recipient selector. Draft filters apply only when the form is submitted.

import { useEffect, useState, type FormEvent } from 'react'
import Select from '../../components/Select'
import MultiSelect from '../../components/MultiSelect'
import ProfileOverlay from '../profile/ProfileOverlay'
import { message } from '../../lib/errors'
import { statusLabel } from '../../lib/format'
import {
  ACTIVITY_OPTIONS,
  PBE_REGIONS,
  EMPTY_FILTERS,
  EVENT_OPTIONS,
  LEVEL_OPTIONS,
  PERIODS,
  STATUSES,
  PAGE_SIZE,
  searchPathfinders,
  type Filters,
  type Pathfinder,
} from '../../lib/pathfinders'

export default function Search({
  recordsVersion = 0,
  selection,
}: {
  recordsVersion?: number
  selection?: {
    members: Pathfinder[]
    onToggle: (member: Pathfinder) => void
    excludePathfinders: boolean
  }
}) {
  // Honors are a UI placeholder until the catalog and search integration are added.
  const [honors, setHonors] = useState<string[]>([])
  // Keep editing separate from fetching: only submit copies the draft into the active filters.
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [members, setMembers] = useState<Pathfinder[]>([])
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  // Changing this counter retries the same query or reloads results after a profile edit.
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    // Cancel obsolete requests so an older response cannot replace newer search results.
    const controller = new AbortController()
    searchPathfinders(filters, page, controller.signal, selection?.excludePathfinders)
      .then((result) => {
        if (!controller.signal.aborted) {
          setMembers(result.members)
          setCount(result.count)
          setError('')
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => controller.abort()
  }, [filters, page, attempt, recordsVersion, selection?.excludePathfinders])
  // Update one draft field without replacing the other filter choices.
  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  // Clear the previous page and open profile before a new request starts.
  function beginSearch() {
    setBusy(true)
    setError('')
    setMembers([])
    setCount(0)
    setSelected(null)
  }
  // Apply the completed filter draft and restart pagination at the first page.
  function submit(event: FormEvent) {
    event.preventDefault()
    beginSearch()
    setFilters({ ...draft })
    setPage(0)
  }
  // Reset both visible inputs and the active query, including the placeholder honors selection.
  function reset() {
    setHonors([])
    beginSearch()
    setDraft(EMPTY_FILTERS)
    setFilters({ ...EMPTY_FILTERS })
    setPage(0)
  }
  return (
    <>
      {/* Filter form: changes remain local until Search is submitted. */}
      <section className="panel">
        <h2>Find a Pathfinder</h2>
        <p className="muted">
          Select one or more options, or type and press Enter to add them. Match any bubble within
          each category, and every selected category. Years apply to all selected history
          categories. Leave filters blank to browse all members.
        </p>
        <form onSubmit={submit} onReset={reset} className="filters">
          <label className="name-filter">
            Name
            <input
              type="search"
              value={draft.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Search by name"
              maxLength={200}
            />
          </label>
          <Select
            label="Status"
            value={draft.status}
            options={
              selection?.excludePathfinders
                ? STATUSES.filter((status) => status !== 'Pathfinder')
                : STATUSES
            }
            onChange={(value) => update('status', value)}
          />
          <MultiSelect
            label="Years"
            values={draft.year}
            options={[...PERIODS]}
            onChange={(value) => update('year', value)}
          />
          <MultiSelect
            label="Level Earned"
            values={draft.level}
            options={LEVEL_OPTIONS}
            groupKey={(option) => option.split(' / ')[0].split(' (')[0]}
            variantLabel={(option) => option.split(' / ')[1] ?? 'Any'}
            onChange={(value) => update('level', value)}
          />
          <MultiSelect
            label="Extracurricular"
            values={draft.activity}
            options={ACTIVITY_OPTIONS}
            detailOptions={{ PBE: PBE_REGIONS }}
            groupKey={(option) => option.split(' / ')[0].split(' (')[0]}
            variantLabel={(option) =>
              option.startsWith('PBE / ')
                ? (option.split(' / ')[2] ?? 'Any placement')
                : (option.split(' / ')[1] ?? 'Any')
            }
            onChange={(value) => update('activity', value)}
          />
          <MultiSelect
            label="Red Zone Events"
            values={draft.event}
            options={EVENT_OPTIONS}
            groupKey={(option) => option.split(' / ')[0].split(' (')[0]}
            variantLabel={(option) => option.split(' / ')[1] ?? 'Any'}
            onChange={(value) => update('event', value)}
          />
          <MultiSelect
            label="Honors"
            values={honors}
            options={[]}
            onChange={setHonors}
            emptyMessage="No honors available yet"
          />
          <div className="actions">
            <button type="submit" disabled={busy}>
              Search records
            </button>
            <button type="reset" className="secondary">
              Clear filters
            </button>
          </div>
        </form>
      </section>
      <section className="panel" aria-busy={busy}>
        <div className="section-heading">
          <h2>Members</h2>
          <span role="status">
            {busy ? 'Searching…' : `${count} ${count === 1 ? 'member' : 'members'} found`}
          </span>
        </div>
        {error ? (
          <>
            <p role="alert" className="error">
              {error}
            </p>
            <button
              onClick={() => {
                beginSearch()
                setAttempt(attempt + 1)
              }}
            >
              Try again
            </button>
          </>
        ) : !busy && members.length === 0 ? (
          <p>
            No members found. Try fewer filters. If this is a new database, add the first records
            through Supabase.
          </p>
        ) : (
          members.length > 0 && (
            <>
              {/* The same results table supports browsing and bulk-recipient selection. */}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {selection && <th>Select</th>}
                      <th>First Name</th>
                      <th>Last Name</th>
                      <th>Status</th>
                      <th>Class/Titles</th>
                      <th>Current activities</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => {
                      // Current columns describe registration only; historical achievements stay in the profile dialog.
                      const inactive = !member.has_current_data || member.status === 'not_active'
                      const hasTitle = member.status === 'pathfinder' || member.status === 'staff'
                      return (
                        <tr key={member.id}>
                          {selection && (
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${member.name}`}
                                checked={selection.members.some((value) => value.id === member.id)}
                                onChange={() => selection.onToggle(member)}
                              />
                            </td>
                          )}
                          <td>
                            <button
                              className="member-link"
                              aria-label={`Open profile for ${member.name}`}
                              aria-haspopup="dialog"
                              onClick={() => setSelected(member.id)}
                            >
                              {member.first_name}
                            </button>
                          </td>
                          <td>{member.last_name || 'Not recorded'}</td>
                          <td>{statusLabel(member.status)}</td>
                          <td>
                            {hasTitle
                              ? (member.current_title as string[] | null)?.join(', ') ||
                                'Not recorded'
                              : 'N/A'}
                          </td>
                          <td>
                            {inactive || member.status === 'staff'
                              ? 'N/A'
                              : (member.current_activities as string[] | null)?.join(', ') ||
                                'None recorded'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {/* Disable page navigation during loading to avoid overlapping page requests. */}
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={page === 0 || busy}
                  onClick={() => {
                    beginSearch()
                    setPage(page - 1)
                  }}
                >
                  Previous
                </button>
                <span>
                  Page {page + 1} of {Math.max(1, Math.ceil(count / PAGE_SIZE))}
                </span>
                <button
                  className="secondary"
                  disabled={(page + 1) * PAGE_SIZE >= count || busy}
                  onClick={() => {
                    beginSearch()
                    setPage(page + 1)
                  }}
                >
                  Next
                </button>
              </div>
            </>
          )
        )}
      </section>
      {/* Open the selected profile above the search screen; saved edits trigger a reload. */}
      {selected !== null && (
        <ProfileOverlay
          key={selected}
          id={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => setAttempt((value) => value + 1)}
        />
      )}
    </>
  )
}
