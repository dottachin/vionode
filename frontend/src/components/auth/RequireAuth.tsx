import { Navigate, useLocation } from "react-router-dom";
import { getAuthToken } from "@/api/auth";
import type { JSX } from "react";

type Props = { children: JSX.Element };

export default function RequireAuth({ children }: Props) {
  const token = getAuthToken();
  const location = useLocation();

  if (!token) {
    const redirectTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirectTo=${redirectTo}`} replace />;
  }
  return children;
}
