import PropTypes from 'prop-types'

export default function Calendar({ value, onChange }) {
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

Calendar.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
}
