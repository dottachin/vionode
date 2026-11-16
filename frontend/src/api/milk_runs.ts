// src/api/milk_runs.ts
import {api} from "@/api/_axios"
import type { MilkRun } from "@/types/milk_run"
import type { OptimizerResult } from "@/types/optimizer"

const API = import.meta.env.VITE_API_BASE || '/api';

const BASE_URL = `${API}/milk-runs`

export const fetchMilkRuns = async (): Promise<MilkRun[]> => {
  const res = await api.get(BASE_URL)
  return res.data
}

export const createMilkRun = async (payload: { name: string; site_ids: string[]; depot_id: string }): Promise<MilkRun> => {
  const res = await api.post(BASE_URL, payload)
  return res.data
}

export const updateMilkRun = async (id: string, payload: { name?: string; site_ids?: string[]; depot_id: string }): Promise<MilkRun> => {
  const res = await api.put(`${BASE_URL}/${id}`, payload)
  return res.data
}

export const deleteMilkRun = async (id: string): Promise<void> => {
  await api.delete(`${BASE_URL}/${id}`)
}

// stays the same, just moved under this file
export const optimizeMilkRun = async (
  depot_id: string,
  site_ids: string[]
): Promise<OptimizerResult > => {
  const res = await api.post(`${API}/optimization/milk-run`, {
    depot_id,
    site_ids
  })
  return res.data
}
