// ServiceGrid.jsx
import { ServiceCard } from "./ServiceCard";

export interface Service {
  id: number | string
  name: string
  duration?: string
  description?: string
}

export interface ServiceGridProps {
  services: Service[]
  selectedId?: number | string
  onSelect: (service: Service) => void
}

export function ServiceGrid({ services, selectedId, onSelect }: ServiceGridProps) {
    return (
        <div>
            <h2 className="text-xl font-medium text-gray-900 mb-3">Select a Service</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {services.map(service => (
                    <ServiceCard
                        key={service.id}
                        service={service}
                        selected={service.id === selectedId}
                        onSelect={onSelect}
                    />
                ))}
            </div>
        </div>
    );
}
