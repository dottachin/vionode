// src/api/order_sets.ts
import {api} from "@/api/_axios"
import type { OrderSet, Order } from "@/types/order";

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// 💾 Save a new order set
export const saveOrderSet = async (name: string, orders: Order[]): Promise<OrderSet> => {
  const res = await api.post(`${API_BASE}/order-sets`, { name, orders });
  return res.data;
};

// 📂 Fetch list of saved order sets
export const fetchOrderSets = async (): Promise<OrderSet[]> => {
  const res = await api.get(`${API_BASE}/order-sets`);
  return res.data;
};

// 🔁 Load a previously saved set by ID
export const loadOrderSet = async (id: number | string): Promise<OrderSet> => {
  const res = await api.get(`${API_BASE}/order-sets/${id}`);
  return res.data;
};

// ✏️ Update a set (rename and/or replace orders)
export const updateOrderSet = async (
  id: number | string,
  payload: { name?: string; orders?: Order[] }
): Promise<OrderSet> => {
  const res = await api.put(`${API_BASE}/order-sets/${id}`, payload);
  return res.data;
};

// 🗑️ Delete a set
export const deleteOrderSet = async (id: number | string): Promise<void> => {
  await api.delete(`${API_BASE}/order-sets/${id}`);
};
