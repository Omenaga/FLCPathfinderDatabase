import { useEffect, useRef, type ReactNode } from 'react'

export default function Modal({ title, header, headerActions, children, onClose, closeDisabled = false, wide = false }: { title: string; header?: ReactNode; headerActions?: ReactNode; children: ReactNode; onClose: () => void; closeDisabled?: boolean; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.querySelector<HTMLButtonElement>('.modal-close')?.focus() }, [title])
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
  return <dialog ref={dialog} className={`profile-overlay${wide ? ' wide-overlay' : ''}`} aria-label={title} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!closeDisabled) onClose() }}>
    <header className="modal-header">
      {header}
      <div className="modal-header-actions">
        {headerActions}
        <button className="secondary modal-close" disabled={closeDisabled} onClick={onClose} autoFocus>Close</button>
      </div>
    </header>
    {children}
  </dialog>
}
