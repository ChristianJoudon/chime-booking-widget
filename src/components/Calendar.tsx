export interface CalendarProps {
  value: string
  onChange: (value: string) => void
}

export default function Calendar({ value, onChange }: CalendarProps) {
  const today = new Date().toISOString().split('T')[0]
  return (
    <div className="calendar-picker">
      <label>
        Date:
        <input type="date" value={value} min={today} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  )
}


