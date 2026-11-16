import {api} from "@/api/_axios"
import type { Site } from "@/types/site"

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

export const fetchSites = async (): Promise<Site[]> => {
  const res = await api.get(`${API_BASE}/sites`)
  return res.data
}

export const createSite = async (site: Partial<Site>): Promise<Site> => {
  const res = await api.post(`${API_BASE}/sites`, site)
  return res.data
}

export const updateSite = async (id: string, updates: Partial<Site>): Promise<Site> => {
  const res = await api.put(`${API_BASE}/sites/${id}`, updates)
  return res.data
}

export const deleteSite = async (id: string): Promise<void> => {
  await api.delete(`${API_BASE}/sites/${id}`)
}
