import PropTypes from 'prop-types'

import { useState } from 'react'

export default function TimeSlots({ slots, onSelect }) {
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

TimeSlots.propTypes = {
  slots: PropTypes.arrayOf(PropTypes.string).isRequired,
  onSelect: PropTypes.func.isRequired,
}
