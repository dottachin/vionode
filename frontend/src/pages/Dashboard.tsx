import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Dashboard() {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-3xl">
          👋 Welcome to Vionode
        </CardTitle>
        <CardDescription>
          Optimize your routes and resources. Pick a module from the menu to get started.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          Use the navigation to manage your fleet, create orders, configure sites and run
          optimizations. You can also try “milk run” routes for predefined simulations.
        </p>
      </CardContent>
    </Card>
  );
}
