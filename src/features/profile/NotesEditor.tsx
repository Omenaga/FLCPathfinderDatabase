import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { message } from '../../lib/errors'
import { saveProfileNotes } from '../../lib/pathfinders'

export default function NotesEditor({ id, initialNotes }: { id: number; initialNotes: string }) {
  const notesId = useId()
  const [notes, setNotes] = useState(initialNotes)
  const [savedNotes, setSavedNotes] = useState(initialNotes)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  async function save(event: FormEvent) {
    event.preventDefault()
    const controller = new AbortController(); request.current = controller
    setPending(true); setError(''); setSaved(false)
    try {
      await saveProfileNotes(id, notes, controller.signal)
      if (!controller.signal.aborted) { setSavedNotes(notes); setSaved(true) }
    } catch(error) { if (!controller.signal.aborted) setError(message(error)) }
    finally { if (!controller.signal.aborted) setPending(false) }
  }
  return <form className="profile-notes" onSubmit={save}><label htmlFor={notesId}>Notes</label><textarea id={notesId} value={notes} rows={5} disabled={pending} onChange={event => { setNotes(event.target.value); setSaved(false) }} placeholder="Add a sentence or several paragraphs" />
    <button disabled={pending || notes === savedNotes}>{pending ? 'Saving...' : 'Save Notes'}</button>
    {notes !== savedNotes && <p className="muted">Unsaved changes - save before closing the profile.</p>}
    {saved && <p role="status">Notes saved</p>}{error && <p role="alert" className="error">{error}</p>}
  </form>
}
