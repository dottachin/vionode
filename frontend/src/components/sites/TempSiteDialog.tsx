import { useState } from "react";
import type { Site } from "@/types/site";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = {
  trigger: React.ReactNode;
  onCreate: (site: Site) => void;
  defaultCategory?: string;
};

export function TempSiteDialog({ trigger, onCreate, defaultCategory = "client" }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [category, setCategory] = useState(defaultCategory);

  const clear = () => {
    setName("");
    setAddress("");
    setLatitude("");
    setLongitude("");
    setCategory(defaultCategory);
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    const id = `temp-${Date.now()}`;
    const site: Site = {
      id,
      name: name.trim(),
      address: address.trim(),
      category,
      coordinates: {
        latitude: Number(latitude) || 0,
        longitude: Number(longitude) || 0,
      },
      service_time: 0,
      operational_hours: { start: "00:00", end: "23:59" },
    };
    onCreate(site);
    clear();
    setOpen(false);
  };

  const canCreate = Boolean(name.trim());

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a temporary site</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Temporary site" />
          </div>
          <div className="space-y-1">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Latitude</Label>
              <Input value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="0.0" />
            </div>
            <div className="space-y-1">
              <Label>Longitude</Label>
              <Input value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="0.0" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client">Client</SelectItem>
                <SelectItem value="depot">Depot</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleCreate} disabled={!canCreate} className="w-full">
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
