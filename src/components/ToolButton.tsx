import type React from 'react'

interface ToolButtonProps {
  active?: boolean
  disabled?: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}

export function ToolButton({ active, disabled, icon, label, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`tool-button ${active ? 'active' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
