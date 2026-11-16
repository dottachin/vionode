import axios, { AxiosHeaders, type InternalAxiosRequestConfig, type AxiosError } from "axios";
import { getAuthToken, setAuthToken } from "@/api/auth";
import { toast } from "sonner";

export const api = axios.create({
  withCredentials: false,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAuthToken();
  if (token) {
    // Ensure headers is an AxiosHeaders instance, then set the header.
    // (Prevents "missing set/get/has" type error)
    if (!config.headers || !(config.headers as any).set) {
      config.headers = new AxiosHeaders(config.headers as any);
    }
    (config.headers as AxiosHeaders).set("Authorization", `Bearer ${token}`);
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      setAuthToken(null);
      try {
        toast.error("Session expirée", { description: "Veuillez vous reconnecter." });
      } catch {}
      const current = window.location.pathname + window.location.search;
      if (!current.startsWith("/login")) {
        window.location.assign(`/login?redirectTo=${encodeURIComponent(current)}`);
      }
    }
    return Promise.reject(error);
  }
);
