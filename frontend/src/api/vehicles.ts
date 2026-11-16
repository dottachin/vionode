import {api} from "@/api/_axios"
import type { Vehicle, Driver } from "@/types/vehicle";

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// Vehicles
export const fetchVehicles = async (): Promise<Vehicle[]> => {
  const res = await api.get(`${API_BASE}/vehicles`);
  return res.data;
};

export const createVehicle = async (vehicle: Partial<Vehicle>): Promise<Vehicle> => {
  const res = await api.post(`${API_BASE}/vehicles`, vehicle);
  return res.data;
};

export const updateVehicle = async (id: number, updates: Partial<Vehicle>): Promise<Vehicle> => {
  const res = await api.put(`${API_BASE}/vehicles/${id}`, updates);
  return res.data;
};

export const deleteVehicle = async (id: number): Promise<void> => {
  await api.delete(`${API_BASE}/vehicles/${id}`);
};

// Drivers
type CreateDriverPayload = Pick<
  Driver,
  "name"  | "max_daily_driving_hours" | "max_daily_service_hours"
>;
type UpdateDriverPayload = Partial<CreateDriverPayload>;

export const fetchDrivers = async (): Promise<Driver[]> => {
  const res = await api.get(`${API_BASE}/drivers`);
  return res.data;
};

export const createDriver = async (driver: CreateDriverPayload): Promise<Driver> => {
  const res = await api.post(`${API_BASE}/drivers`, driver);
  return res.data;
};

export const updateDriver = async (id: number, updates: UpdateDriverPayload): Promise<Driver> => {
  const res = await api.put(`${API_BASE}/drivers/${id}`, updates);
  return res.data;
};

export const deleteDriver = async (id: number): Promise<void> => {
  await api.delete(`${API_BASE}/drivers/${id}`);
};
