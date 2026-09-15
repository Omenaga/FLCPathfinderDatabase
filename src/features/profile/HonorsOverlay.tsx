import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import { getSupabase } from '../../lib/supabase'
import { message } from '../../lib/errors'
import { statusLabel } from '../../lib/format'

export default function HonorsOverlay({ id, onClose }: { id: number; onClose: () => void }) {
  const [records, setRecords] = useState<{ id: number; year_earned: string; history_role: string; honors: { name: string } }[] | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    getSupabase().from('honors_earned').select('id,year_earned,history_role,honors(name)').eq('pathfinder_id', id).order('year_earned', { ascending: false }).abortSignal(controller.signal)
      .then(({ data, error }) => { if (!controller.signal.aborted) { if (error) setError(message(error)); else setRecords(data) } })
    return () => controller.abort()
  }, [id, attempt])
  return <Modal title="Honors" header={<h2>Honors</h2>} onClose={onClose}>
    {error ? <><p role="alert" className="error">{error}</p><button onClick={() => { setError(''); setAttempt(v => v + 1) }}>Retry honors</button></> : records === null ? <p role="status">Loading honors…</p> : records.length === 0 ? <p>No honors recorded.</p> :
      <dl className="profile-records">{records.map(record => <div key={record.id}><dt>{record.year_earned}</dt><dd>{record.honors.name} — {statusLabel(record.history_role)}</dd></div>)}</dl>}
  </Modal>
}
