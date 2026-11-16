// src/api/optimizer.ts
import axios from "axios";
import type { OptimizerInput, Metrics, OptimizerResult } from "@/types/optimizer";

const API_BASE = import.meta.env.VITE_SOLVER_BASE || '/solver';
 // solver backend

// Optimize via OR-Tools (multi-depot)
export const optimizeRoutes = async (input: OptimizerInput) => {
  const res = await axios.post(`${API_BASE}/optimization/routes/multi-depot`, input, {
    headers: { "Content-Type": "application/json" },
    // allow long solver runs (up to 2 hours)
    timeout: 7_200_000,
  });
  return res.data as {
    result: OptimizerResult;
    metrics?: Metrics;
    solver_run_id?: string | null;
    result_id?: string | null;
  };
};

// Score the manual sequence (same response shape as optimizeRoutes)
export const scoreManualRoute = async (input: OptimizerInput) => {
  const res = await axios.post(`${API_BASE}/optimization/manual-stats`, input, {
    headers: { "Content-Type": "application/json" },
    // allow long solver runs (up to 2 hours)
    timeout: 7_200_000,
  });
  return res.data as {
    result: OptimizerResult;
    metrics: Metrics;
    solver_run_id?: string | null;
    result_id?: string | null;
  };
};
