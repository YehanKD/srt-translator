import { Modal, ModalFooter } from './Modal'

interface Props {
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  /** Renders the confirm action as destructive. */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Confirmation dialog. Replaces native confirm() so it matches the app. */
export function ConfirmModal({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel
}: Props) {
  return (
    <Modal onClose={onCancel} width={22}>
      <div className="px-4 pt-4 pb-1">
        <h3 className="text-base font-[590] text-text">{title}</h3>
        <p className="mt-1.5 text-micro leading-relaxed text-text-muted">
          {body}
        </p>
      </div>
      <ModalFooter>
        <button onClick={onCancel} className="btn btn-secondary">
          {cancelLabel}
        </button>
        <button onClick={onConfirm} className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}>
          {confirmLabel}
        </button>
      </ModalFooter>
    </Modal>
  )
}
