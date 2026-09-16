export default function ProfileNotes({ notes }: { notes: string }) {
  return <section className="profile-notes" aria-label="Notes">
    <h3>Notes</h3>
    {notes.trim() && <p>{notes}</p>}
  </section>
}
