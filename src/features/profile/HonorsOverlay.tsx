import { useEffect, useState } from 'react'
import HistoryRecords from './HistoryRecords'
import Modal from '../../components/Modal'
import { getSupabase } from '../../lib/supabase'
import { message } from '../../lib/errors'

export default function HonorsOverlay({ id, onClose }: { id: number; onClose: () => void }) {
  const [records, setRecords] = useState<{ id: number; year_earned: string | null; honors: { name: string } }[] | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    getSupabase().from('honors_earned').select('id,year_earned,honors(name)').eq('pathfinder_id', id).order('year_earned', { ascending: false, nullsFirst: false }).abortSignal(controller.signal)
      .then(({ data, error }) => { if (!controller.signal.aborted) { if (error) setError(message(error)); else setRecords(data) } })
    return () => controller.abort()
  }, [id, attempt])
  return <Modal title="Honors" header={<h2>Honors</h2>} onClose={onClose}>
    {error ? <><p role="alert" className="error">{error}</p><button onClick={() => { setError(''); setAttempt(v => v + 1) }}>Retry honors</button></> : records === null ? <p role="status">Loading honors…</p> : records.length === 0 ? <p>No honors recorded.</p> :
      <HistoryRecords newestFirst records={records.map(record => ({ year: record.year_earned, detail: record.honors.name }))} />}
  </Modal>
}
