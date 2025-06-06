import PropTypes from 'prop-types'

export default function ServiceList({ services, onSelect }) {
  return (
    <div className="service-list">
      {services.map((s) => (
        <button key={s.id} className="service-card" onClick={() => onSelect(s)}>
          <div className="service-name">{s.name}</div>
          {s.duration && <div className="service-duration">{s.duration} mins</div>}
          {s.deposit && <div className="service-deposit">Deposit ${s.deposit}</div>}
        </button>
      ))}
    </div>
  )
}

ServiceList.propTypes = {
  services: PropTypes.arrayOf(PropTypes.object).isRequired,
  onSelect: PropTypes.func.isRequired,
}
