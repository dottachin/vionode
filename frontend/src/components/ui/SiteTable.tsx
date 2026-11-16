import { useEffect, useMemo, useState } from "react";
import { Badge } from "rizzui/badge";
import { Button } from "rizzui/button";
import { Checkbox } from "rizzui/checkbox";
import { Input } from "rizzui/input";
import { Select } from "rizzui/select";
import { Table } from "rizzui/table";
import { Text } from "rizzui/text";
import { Title } from "rizzui/title";
import { cn } from "rizzui/cn";

export type SiteRow = {
  id: string;
  name: string;
  address?: string | null;
  category?: string;
  code?: string;
  tags?: string[];
};

type Props = {
  items: SiteRow[];
  selectedIds: string[];
  onToggle: (id: string) => void; // toggle single
  onSelectAll?: (ids: string[]) => void; // select page
  onClearAll?: () => void;
  onRowClick?: (id: string) => void;
  pageSize?: number;
  multi?: boolean; // allow multiple selection
  highlightedId?: string | null;
  title?: string;
  showId?: boolean;
  columnLabel?: string;
};

export default function SiteTable({
  items,
  selectedIds,
  onToggle,
  onSelectAll,
  onClearAll,
  onRowClick,
  highlightedId = null,
  title = "Sites",
  showId = false,
  columnLabel = "Category",
  pageSize = 10,
  multi = true,
}: Props) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "address">("name");
  const [page, setPage] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState<string | "">("");

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) if (i.category) set.add(i.category);
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const tq = q.trim().toLowerCase();
    return items
      .filter((it) => (categoryFilter ? it.category === categoryFilter : true))
      .filter((it) => {
        if (!tq) return true;
        return (
          it.name.toLowerCase().includes(tq) ||
          (it.address ?? "").toLowerCase().includes(tq) ||
          (it.code ?? "").toLowerCase().includes(tq)
        );
      })
      .sort((a, b) => (a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? "")));
  }, [items, q, sortKey, categoryFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    if (page >= pageCount) {
      setPage(Math.max(0, pageCount - 1));
    }
  }, [page, pageCount]);

  const pageItems = filtered.slice(page * pageSize, page * pageSize + pageSize);
  const allPageSelected = pageItems.length > 0 && pageItems.every((it) => selectedIds.includes(it.id));
  const isIndeterminate =
    pageItems.length > 0 && !allPageSelected && pageItems.some((it) => selectedIds.includes(it.id));

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border/80 bg-white shadow-sm dark:border-border/40 dark:bg-background">
      <div className="flex flex-col gap-3 border-b border-border/70 bg-white px-4 py-3 dark:bg-background">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <Title as="h4" className="text-sm font-semibold text-text-primary">
              {title}
            </Title>
            <Text className="text-xs text-text-secondary">
              {filtered.length} result(s) | {selectedIds.length} selection(s)
            </Text>
          </div>
          <Badge color="info" variant="flat" className="text-xs font-semibold">
            {selectedIds.length} selection(s)
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search name, address or code"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(0);
            }}
            className="w-64 min-w-[240px]"
            size="md"
          />
          <Select
            options={[
              { value: "name", label: "Sort: name" },
              { value: "address", label: "Sort: address" },
            ]}
            value={sortKey}
            onChange={(value) => setSortKey(String(value) as "name" | "address")}
            size="sm"
            selectClassName="min-w-[160px]"
            getOptionValueKey="value"
          />
          <Select
            options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c, label: c }))]}
            value={categoryFilter}
            onChange={(value) => {
              setCategoryFilter(value ? String(value) : "");
              setPage(0);
            }}
            size="sm"
            clearable
            selectClassName="min-w-[180px]"
            placeholder="All categories"
            getOptionValueKey="value"
          />
        </div>
      </div>

      <div className="flex-1 px-4 pb-4">
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-white/90 shadow-inner dark:border-border/40 dark:bg-background/90">
          {pageItems.length === 0 ? (
            <div className="flex items-center justify-between px-4 py-5">
              <Text className="text-sm text-text-secondary">
                {items.length === 0 ? "No data available." : "No rows match your filters."}
              </Text>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQ("");
                  setCategoryFilter("");
                  setPage(0);
                }}
              >
                Reset filters
              </Button>
            </div>
          ) : (
            <Table variant="modern" className="text-sm">
              <Table.Header>
                <Table.Row>
                  <Table.Head className="w-12">
                    {multi ? (
                      <Checkbox
                        checked={!!pageItems.length && allPageSelected}
                        indeterminate={isIndeterminate}
                        onChange={(event) => {
                          event.stopPropagation();
                          if (allPageSelected) onClearAll?.();
                          else onSelectAll?.(pageItems.map((i) => i.id));
                        }}
                        aria-label="Select page"
                        size="sm"
                      />
                    ) : null}
                  </Table.Head>
                  <Table.Head className="text-left">Name</Table.Head>
                  <Table.Head className="text-left">Address</Table.Head>
                  <Table.Head className="text-left">{columnLabel}</Table.Head>
                  {showId ? <Table.Head className="text-right">ID</Table.Head> : null}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {pageItems.map((row) => {
                  const selected = selectedIds.includes(row.id);
                  const highlighted = highlightedId === row.id;
                  return (
                    <Table.Row
                      key={row.id}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-blue-lighter/40 dark:hover:bg-blue-lighter/10",
                        selected ? "bg-blue-lighter/60 dark:bg-blue-lighter/10" : "",
                        highlighted ? "ring-1 ring-blue/50" : ""
                      )}
                      onClick={() => onRowClick?.(row.id)}
                    >
                      <Table.Cell className="w-12">
                        <Checkbox
                          checked={selected}
                          onChange={(event) => {
                            event.stopPropagation();
                            onToggle(row.id);
                          }}
                          aria-label={`Select ${row.name}`}
                          size="sm"
                        />
                      </Table.Cell>
                      <Table.Cell className="font-semibold text-text-primary">{row.name}</Table.Cell>
                      <Table.Cell className="max-w-[220px] truncate text-text-secondary">{row.address ?? "-"}</Table.Cell>
                      <Table.Cell className="text-text-secondary">{row.category ?? "Not set"}</Table.Cell>
                      {showId ? (
                        <Table.Cell className="text-right text-xs text-text-secondary">{row.code ?? row.id}</Table.Cell>
                      ) : null}
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/40 px-4 py-3 text-sm dark:border-border/40 dark:bg-muted/20">
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
            </Button>
            <Text className="text-xs text-text-secondary">
              Page {page + 1} / {pageCount} | {pageItems.length} shown
            </Text>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="solid" onClick={() => onSelectAll?.(items.map((it) => it.id))}>
              Select all
            </Button>
            <Button size="sm" variant="flat" onClick={() => onClearAll?.()}>
              Clear
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
