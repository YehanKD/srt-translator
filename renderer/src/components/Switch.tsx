interface Props {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  title?: string
  disabled?: boolean
}

/**
 * Compact toggle. Rendered as a real switch for assistive tech, with the label
 * sitting outside the control so clicking the words also toggles it.
 */
export function Switch({ checked, onChange, label, title, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      title={title}
      className="group flex items-center gap-2 select-none disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span
        className="relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors"
        style={{
          background: checked ? 'var(--t-teal)' : 'var(--t-surface-sunken)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)'
        }}
      >
        <span
          className="inline-block h-3 w-3 rounded-full bg-white transition-transform"
          style={{
            transform: checked ? 'translateX(17px)' : 'translateX(3px)',
            transitionTimingFunction: 'var(--ease-out)'
          }}
        />
      </span>
      <span
        className={`text-micro transition-colors ${
          checked ? 'text-text-body' : 'text-text-muted'
        }`}
      >
        {label}
      </span>
    </button>
  )
}
