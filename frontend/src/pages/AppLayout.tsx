import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Rocket,
  LayoutDashboard,
  Truck,
  Package,
  MapPin,
  Route as RouteIcon,
  Menu,
  GitCompare, // NEW
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type NavItem = {
  path: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const navItems: NavItem[] = [
  { path: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { path: "/fleet", label: "Fleet", icon: Truck },
  { path: "/sites", label: "Sites", icon: MapPin },
  { path: "/orders", label: "Orders", icon: Package },

  { path: "/milk-run", label: "Milk run", icon: RouteIcon },
  { path: "/optimization-global", label: "Global optimization", icon: Globe },
  { path: "/compare", label: "Compare results", icon: GitCompare },
];

export default function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-muted-foreground" aria-hidden />
            <span className="text-sm font-semibold sm:text-base">Vionode</span>
          </div>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {navItems.map(({ path, label, icon: Icon }) => (
              <NavLink
                key={path}
                to={path}
                end
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-accent hover:text-foreground"
                  )
                }
              >
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span className="truncate">{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto" />

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Rocket className="h-5 w-5 text-muted-foreground" aria-hidden />
                  Vionode
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 grid gap-1">
                {navItems.map(({ path, label, icon: Icon }) => (
                  <NavLink
                    key={path}
                    to={path}
                    end
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-foreground hover:bg-accent hover:text-foreground"
                      )
                    }
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
