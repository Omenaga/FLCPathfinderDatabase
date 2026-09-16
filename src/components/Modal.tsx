// Shared native dialog. Keeps background scrolling locked and restores focus when closed.

import { useEffect, useRef, type ReactNode } from 'react'

export default function Modal({
  title,
  header,
  headerActions,
  children,
  onClose,
  closeDisabled = false,
  hideClose = false,
  wide = false,
}: {
  title: string
  header?: ReactNode
  headerActions?: ReactNode
  children: ReactNode
  onClose: () => void
  closeDisabled?: boolean
  hideClose?: boolean
  wide?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  // A new dialog step may change its title; start that step at the top and focus a header action.
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    element.scrollTop = 0
    const action =
      element.querySelector<HTMLButtonElement>('.modal-close') ??
      element.querySelector<HTMLButtonElement>('.modal-header-actions button:not(:disabled)')
    action?.focus()
  }, [title])
  useEffect(() => {
    // Remember the previous focus and scroll settings so nested dialogs restore their parent correctly.
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
  return (
    <dialog
      ref={dialog}
      className={`profile-overlay${wide ? ' wide-overlay' : ''}`}
      aria-label={title}
      onCancel={(event) => {
        // Handle Escape through the parent callback so React state stays in sync with the native dialog.
        event.preventDefault()
        event.stopPropagation()
        if (!closeDisabled) onClose()
      }}
    >
      <header className="modal-header">
        {header}
        <div className="modal-header-actions">
          {headerActions}
          {!hideClose && (
            <button
              className="secondary modal-close"
              disabled={closeDisabled}
              onClick={onClose}
              autoFocus
            >
              Close
            </button>
          )}
        </div>
      </header>
      {children}
    </dialog>
  )
}
