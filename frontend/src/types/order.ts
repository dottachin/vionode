export interface Order {
  id: string
  pickup_site_id: string
  delivery_site_id: string
  weight: number
  surface: number
  goods_type: string
  requires_refrigeration: boolean
  hazardous_types: string[]
  notes?: string
}

export interface OrderSet {
  id: string              // Backend-generated
  name: string            // User-defined
  created_at: string      // ISO date string
  orders: Order[]         // Snapshot of orders at save time
}
