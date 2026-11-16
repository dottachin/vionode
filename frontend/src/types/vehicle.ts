export interface Driver {
  id: string | number; // backend uses BIGINT -> number; frontend often normalizes to string
  name: string;
  license_number?: string;
  max_daily_driving_hours: number;
  max_daily_service_hours: number;
}

export interface Vehicle {
  id: string;
  label?: string;
  depot_id?: string;
  weight: number;
  surface: number;
  length?: number;
  height?: number;
  equipment?: string[];
  type: string;
  emission_rate?: number;
  max_distance?: number;           // km (UI convenience)
  max_distance_meters?: number;    // meters (solver)
  fixed_cost?: number;
  driver_ids: Array<string | number>;
  fuel_consumption: number;
  fuel_type: string;
}
