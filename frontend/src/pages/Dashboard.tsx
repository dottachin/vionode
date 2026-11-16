import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Dashboard() {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-3xl">
          👋 Bienvenue sur Vionode
        </CardTitle>
        <CardDescription>
          Optimisez vos tournées et vos ressources. Choisissez un module dans le menu pour commencer.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          Utilisez la navigation pour gérer votre flotte, créer des commandes, configurer les sites et lancer
          des optimisations. Vous pouvez aussi tester les tournées « Milk run » pour des simulations prédéfinies.
        </p>
      </CardContent>
    </Card>
  );
}
