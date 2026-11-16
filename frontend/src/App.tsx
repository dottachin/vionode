import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppLayout from "@/pages/AppLayout";
import RequireAuth from "@/components/auth/RequireAuth";

import Dashboard from "@/pages/Dashboard";
import FleetManager from "@/pages/FleetManager";
import OrderManager from "@/pages/OrderManager";
import SiteManager from "@/pages/SiteManager";
import MilkRunPage from "@/pages/MilkRunPage";
import CompareResultsPage from "@/pages/CompareResultsPage";
import LoginPage from "@/pages/Login"; // <- from previous message
import OptimizationGlobal from "@/pages/OptimizationGlobal";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected (everything under AppLayout) */}
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/fleet" element={<FleetManager />} />
          <Route path="/orders" element={<OrderManager />} />
          <Route path="/sites" element={<SiteManager />} />
          <Route path="/milk-run" element={<MilkRunPage />} />
          <Route path="/optimization-global" element={<OptimizationGlobal />} />
          <Route path="/compare" element={<CompareResultsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
