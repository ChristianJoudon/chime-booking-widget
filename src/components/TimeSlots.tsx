import { useState } from 'react'

export interface TimeSlotsProps {
  slots: string[]
  onSelect: (time: string) => void
}

export default function TimeSlots({ slots, onSelect }: TimeSlotsProps) {
  const [selected, setSelected] = useState('')
  function handleClick(t) {
    setSelected(t)
    onSelect(t)
  }
  return (
    <div className="time-slots">
      {slots.map((t) => (
        <button
          key={t}
          className={`time-slot${selected === t ? ' active' : ''}`}
          onClick={() => handleClick(t)}
        >
          {t}
        </button>
      ))}
    </div>
  )
}


