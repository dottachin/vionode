// src/api/optimizations.ts
import { api } from "@/api/_axios";
import type {
  OptimizationCreate,
  OptimizationRecord,
  GlobalOptimizationCreate,
  GlobalOptimizationRecord,
  GlobalOptimizationUpdate,
} from "@/types/optimizer";

// backend_db base URL
const DB_BASE = import.meta.env.VITE_API_BASE || "/sapiolver";
// your backend for saving/loading stats

export async function deleteOptimization(id: string | number): Promise<void> {
  await api.delete(`${DB_BASE}/optimizations/${id}`);
}

export const saveOptimization = async (
  payload: OptimizationCreate
): Promise<OptimizationRecord> => {
  const res = await api.post(`${DB_BASE}/optimizations`, payload, {
    headers: { "Content-Type": "application/json" },
  });
  return res.data;
};

export const saveGlobalOptimization = async (
  payload: GlobalOptimizationCreate
): Promise<GlobalOptimizationRecord> => {
  const res = await api.post(`${DB_BASE}/global-optimizations`, payload, {
    headers: { "Content-Type": "application/json" },
  });
  return res.data;
};

export const fetchGlobalOptimizations = async (): Promise<GlobalOptimizationRecord[]> => {
  const res = await api.get(`${DB_BASE}/global-optimizations`, {
    params: { limit: 200, offset: 0 },
  });
  return res.data;
};

export const fetchGlobalOptimization = async (
  id: string | number
): Promise<GlobalOptimizationRecord> => {
  const res = await api.get(`${DB_BASE}/global-optimizations/${id}`);
  return res.data;
};

export const updateGlobalOptimization = async (
  id: string | number,
  payload: GlobalOptimizationUpdate
): Promise<GlobalOptimizationRecord> => {
  const res = await api.patch(`${DB_BASE}/global-optimizations/${id}`, payload, {
    headers: { "Content-Type": "application/json" },
  });
  return res.data;
};

export const deleteGlobalOptimization = async (id: string | number): Promise<void> => {
  await api.delete(`${DB_BASE}/global-optimizations/${id}`);
};

export const fetchOptimizationsByMilkRun = async (
  milkRunId: string
): Promise<OptimizationRecord[]> => {
  const res = await api.get(`${DB_BASE}/optimizations`, {
    params: { milk_run_id: milkRunId },
  });
  return res.data;
};

export const fetchOptimizationsByOrderSet = async (
  orderSetId: string
): Promise<OptimizationRecord[]> => {
  const res = await api.get(`${DB_BASE}/optimizations`, {
    params: { order_set_id: orderSetId },
  });
  return res.data;
};

/**
 * Returns the most recent manual OptimizationRecord for the given milk run,
 * derived purely by filtering the regular list.
 *
 * Manual detection:
 *   - record.note === "manual" (primary flag)
 *   - OR record.params?.kind === "manual" (fallback)
 */
export const fetchLastManualByMilkRun = async (
  milkRunId: string
): Promise<OptimizationRecord | null> => {
  const all = await fetchOptimizationsByMilkRun(milkRunId);
  if (!Array.isArray(all) || all.length === 0) return null;

  const manuals = all.filter((r: any) => r?.note === "manual" || r?.params?.kind === "manual");
  if (manuals.length === 0) return null;

  manuals.sort(
    (a: any, b: any) =>
      new Date(b?.created_at ?? 0).getTime() - new Date(a?.created_at ?? 0).getTime()
  );

  return manuals[0] ?? null;
};
