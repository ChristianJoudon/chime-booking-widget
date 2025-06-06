import PropTypes from 'prop-types'

export default function Calendar({ value, onChange }) {
  return (
    <div className="calendar-picker">
      <label>
        Date:
        <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  )
}

Calendar.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
}
