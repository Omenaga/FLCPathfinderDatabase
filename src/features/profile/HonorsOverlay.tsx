// Fetch a member's explicitly earned honors and independently calculated Master Award eligibility.
import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import { getSupabase } from '../../lib/supabase'
import { message } from '../../lib/errors'

type EarnedHonor = {
  id: number
  year_earned: string | null
  honors: { name: string; is_master_award: boolean }
}
type AwardStatus = {
  honor_id: number
  name: string
  earned_years: (string | null)[]
  eligible: boolean
}

export default function HonorsOverlay({ id, onClose }: { id: number; onClose: () => void }) {
  const [data, setData] = useState<{
    memberId: number
    records: EarnedHonor[]
    awards: AwardStatus[]
  } | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const client = getSupabase()
        const loadEarned = async () => {
          const rows: EarnedHonor[] = []
          // Read every completion record, including repeated honors, beyond the API's page limit.
          for (let offset = 0; ; offset += 500) {
            const page = await client
              .from('honors_earned')
              .select('id,year_earned,honors(name,is_master_award)')
              .eq('pathfinder_id', id)
              .order('id')
              .range(offset, offset + 499)
              .abortSignal(controller.signal)
            if (page.error) throw page.error
            rows.push(...(page.data ?? []))
            if ((page.data?.length ?? 0) < 500) return rows
          }
        }
        const [earned, awards] = await Promise.all([
          loadEarned(),
          client
            .rpc('get_master_award_status', { p_pathfinder_id: id })
            .abortSignal(controller.signal),
        ])
        if (awards.error) throw awards.error
        if (!controller.signal.aborted) {
          const records = earned.filter((row) => !row.honors.is_master_award)
          records.sort(
            (a, b) =>
              a.honors.name.localeCompare(b.honors.name, undefined, { sensitivity: 'base' }) ||
              (b.year_earned ?? '').localeCompare(a.year_earned ?? '') ||
              a.id - b.id,
          )
          setData({ memberId: id, records, awards: (awards.data ?? []) as AwardStatus[] })
          setError('')
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(message(error))
      }
    }
    void load()
    return () => controller.abort()
  }, [id, attempt])
  return (
    <Modal title="Honors" header={<h2>Honors</h2>} onClose={onClose}>
      {error ? (
        <>
          <p role="alert" className="error">
            {error}
          </p>
          <button
            onClick={() => {
              setError('')
              setData(null)
              setAttempt((v) => v + 1)
            }}
          >
            Retry honors
          </button>
        </>
      ) : data === null || data.memberId !== id ? (
        <p role="status">Loading honors…</p>
      ) : (
        <>
          {data.records.length ? (
            <dl className="profile-records" aria-label="Earned honors">
              {data.records.map((record) => (
                <div key={record.id}>
                  <dt>{record.year_earned ?? 'Unknown'}</dt>
                  <dd>{record.honors.name}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>No honors recorded.</p>
          )}
          <section className="master-awards" aria-label="Master Award">
            <h3>Master Award</h3>
            {data.awards.length ? (
              <ul className="award-status-list">
                {[...data.awards]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((award) => (
                    <li key={award.honor_id}>
                      <strong>{award.name}</strong>
                      {award.earned_years.length > 0 ? (
                        <span>
                          Earned — {award.earned_years.map((year) => year ?? 'Unknown').join(', ')}
                        </span>
                      ) : (
                        <span>Eligible — not yet earned</span>
                      )}
                    </li>
                  ))}
              </ul>
            ) : (
              <p>No earned or eligible Master Awards.</p>
            )}
          </section>
        </>
      )}
    </Modal>
  )
}
