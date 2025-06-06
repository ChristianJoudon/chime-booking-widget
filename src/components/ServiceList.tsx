export interface ServiceListProps {
  services: Array<{ id: string; name: string; duration?: number; deposit?: number }>
  onSelect: (service: any) => void
}

export default function ServiceList({ services, onSelect }: ServiceListProps) {
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


