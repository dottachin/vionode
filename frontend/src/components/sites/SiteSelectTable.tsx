import { useMemo, useState } from "react";
import type { Site } from "@/types/site";
import { normalizeCategory } from "@/utils/sanitizeOptimizerInput";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

type Props = {
  sites: Site[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  title?: string;
  description?: string;
  multi?: boolean;
  className?: string;
};

const categoryLabel: Record<string, string> = {
  depot: "Dépôt",
  client: "Client",
  warehouse: "Entrepôt",
};

export function SiteSelectTable({
  sites,
  selectedIds,
  onChange,
  multi = true,
  className,
}: Props) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (sites || [])
      .map((s) => ({ ...s, category: normalizeCategory(s.category) }))
      .filter((s) => {
        if (category !== "all" && normalizeCategory(s.category) !== category) return false;
        if (!query) return true;
        return (
          s.name?.toLowerCase().includes(query) ||
          (s.address ?? "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sites, search, category]);

  const toggle = (id: string) => {
    if (!multi) {
      onChange([id]);
      return;
    }
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Rechercher un site..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-64"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filtrer par catégorie" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les catégories</SelectItem>
            <SelectItem value="depot">Dépôts</SelectItem>
            <SelectItem value="client">Clients</SelectItem>
            <SelectItem value="warehouse">Entrepôts</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-3 rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={multi && filtered.length > 0 && filtered.every((s) => selectedIds.includes(String(s.id)))}
                  onCheckedChange={(checked) => {
                    if (!multi) return;
                    if (checked) {
                      onChange(filtered.map((s) => String(s.id)));
                    } else {
                      onChange(selectedIds.filter((id) => !filtered.some((s) => String(s.id) === id)));
                    }
                  }}
                  aria-label="Sélectionner tous les sites"
                />
              </TableHead>
              <TableHead>Nom</TableHead>
              <TableHead>Adresse</TableHead>
              <TableHead>Catégorie</TableHead>
              <TableHead>ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((site) => {
              const id = String(site.id);
              const checked = selectedIds.includes(id);
              const cat = normalizeCategory(site.category);
              return (
                <TableRow
                  key={id}
                  className="cursor-pointer transition hover:bg-muted/60"
                  onClick={() => toggle(id)}
                >
                  <TableCell>
                    <Checkbox checked={checked} onCheckedChange={() => toggle(id)} aria-label={`Sélectionner ${site.name}`} />
                  </TableCell>
                  <TableCell className="font-medium">{site.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-[220px]">
                    {site.address || "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{categoryLabel[cat] ?? cat}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{id}</TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  Aucun site à afficher.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
