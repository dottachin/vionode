export interface Site {
  id: string
  name: string
  address: string
  category: string
  coordinates: {
    latitude: number
    longitude: number
  }
  service_time: number
  operational_hours: {
    start: string // e.g., "08:00"
    end: string   // e.g., "18:00"
  }
}
