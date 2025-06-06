import PropTypes from 'prop-types'

export default function TimeSlots({ slots, onSelect }) {
  return (
    <div className="time-slots">
      {slots.map((t) => (
        <button key={t} className="time-slot" onClick={() => onSelect(t)}>{t}</button>
      ))}
    </div>
  )
}

TimeSlots.propTypes = {
  slots: PropTypes.arrayOf(PropTypes.string).isRequired,
  onSelect: PropTypes.func.isRequired,
}
