import { useId } from 'react'

export default function ProfileNotes({ notes }: { notes: string }) {
  const notesId = useId()
  return <section className="profile-notes">
    <label htmlFor={notesId}>Notes</label>
    <textarea id={notesId} value={notes} rows={5} readOnly placeholder="No notes recorded" />
    <button type="button" disabled aria-describedby={`${notesId}-edit-help`}>Edit Profile</button>
    <p id={`${notesId}-edit-help`} className="muted">Profile editing is coming soon.</p>
  </section>
}
