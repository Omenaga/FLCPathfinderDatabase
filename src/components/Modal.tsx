import { useEffect, useRef, type ReactNode } from 'react'

export default function Modal({ title, header, children, onClose }: { title: string; header?: ReactNode; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const element = dialog.current!
    const overflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      element.close()
      document.body.style.overflow = overflow
      opener?.focus()
    }
  }, [])
  return <dialog ref={dialog} className="profile-overlay" aria-label={title} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }}>
    <header className="modal-header">
      {header}
      <button className="secondary modal-close" onClick={onClose} autoFocus>Close</button>
    </header>
    {children}
  </dialog>
}
