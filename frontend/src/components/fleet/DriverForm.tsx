/* eslint-disable @typescript-eslint/no-explicit-any */
import { useId, useMemo, useState } from "react";
import { createDriver } from "@/api/vehicles";
import type { Driver } from "@/types/vehicle";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

type Props = {
  onCreated?: (driver: Driver) => void;
};

// Keep numeric inputs as strings to allow partial editing, convert on submit
type FormState = {
  name: string;
  max_daily_driving_hours: string;   // e.g. "8"
  max_daily_service_hours: string;   // e.g. "10"
};

type FormErrors = Partial<Record<keyof FormState, string>> & {
  _form?: string;
  _cross?: string;
};

export default function DriverForm({ onCreated }: Props) {
  const [form, setForm] = useState<FormState>({
    name: "",
    max_daily_driving_hours: "",
    max_daily_service_hours: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const nameId = useId();
  const driveId = useId();
  const serviceId = useId();

  const isDirty = useMemo(
    () =>
      Boolean(
        form.name.trim() ||
          form.max_daily_driving_hours.trim() ||
          form.max_daily_service_hours.trim()
      ),
    [form]
  );

  const handleChange = (key: keyof FormState, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: undefined, _form: undefined, _cross: undefined }));
  };

  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

  const validate = (data: FormState): FormErrors => {
    const next: FormErrors = {};

    // name
    if (!data.name.trim()) next.name = "Le nom est requis.";
    else if (data.name.trim().length < 2) next.name = "Le nom doit contenir au moins 2 caractères.";

    // driving hours
    const driving = num(data.max_daily_driving_hours);
    if (Number.isNaN(driving)) next.max_daily_driving_hours = "Les heures de conduite sont requises.";
    else if (driving <= 0) next.max_daily_driving_hours = "Doit être > 0.";
    else if (driving > 24) next.max_daily_driving_hours = "Ne doit pas dépasser 24.";

    // service hours
    const service = num(data.max_daily_service_hours);
    if (Number.isNaN(service)) next.max_daily_service_hours = "Les heures de service sont requises.";
    else if (service <= 0) next.max_daily_service_hours = "Doit être > 0.";
    else if (service > 24) next.max_daily_service_hours = "Ne doit pas dépasser 24.";

    // cross-field (service >= driving)
    if (!Number.isNaN(driving) && !Number.isNaN(service) && driving > service) {
      next._cross = "Les heures de service doivent être ≥ aux heures de conduite.";
    }

    return next;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErrors({});
    const v = validate(form);
    if (Object.values(v).some(Boolean)) {
      setErrors(v);
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        name: form.name.trim(),
        max_daily_driving_hours: Number(form.max_daily_driving_hours),
        max_daily_service_hours: Number(form.max_daily_service_hours),
      } as const;

      const driver = await createDriver(payload);
      onCreated?.(driver);
      setForm({
        name: "",
        max_daily_driving_hours: "",
        max_daily_service_hours: "",
      });
      setErrors({});
    } catch {
      setErrors(prev => ({
        ...prev,
        _form: "La création a échoué. Vérifiez les champs ou réessayez.",
      }));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !submitting && isDirty && !Object.values(validate(form)).some(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          Ajouter un Chauffeur
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div>
            <Label className="mb-2 block" htmlFor={nameId}>
              Nom <span className="text-red-500">*</span>
            </Label>
            <Input
              id={nameId}
              value={form.name}
              autoComplete="name"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? `${nameId}-error` : undefined}
              onChange={(e) => handleChange("name", e.target.value)}
            />
            {errors.name && (
              <p id={`${nameId}-error`} className="mt-1 text-sm text-red-600" role="alert">
                {errors.name}
              </p>
            )}
          </div>

          <div>
            <Label className="mb-2 block" htmlFor={driveId}>
              Heures de conduite max / jour <span className="text-red-500">*</span>
            </Label>
            <Input
              id={driveId}
              type="number"
              inputMode="decimal"
              step="0.25"
              min={0}
              max={24}
              placeholder="8"
              value={form.max_daily_driving_hours}
              aria-invalid={Boolean(errors.max_daily_driving_hours)}
              aria-describedby={
                errors.max_daily_driving_hours ? `${driveId}-error` : undefined
              }
              onChange={(e) => handleChange("max_daily_driving_hours", e.target.value)}
            />
            {errors.max_daily_driving_hours && (
              <p id={`${driveId}-error`} className="mt-1 text-sm text-red-600" role="alert">
                {errors.max_daily_driving_hours}
              </p>
            )}
          </div>

          <div>
            <Label className="mb-2 block" htmlFor={serviceId}>
              Heures de service max / jour <span className="text-red-500">*</span>
            </Label>
            <Input
              id={serviceId}
              type="number"
              inputMode="decimal"
              step="0.25"
              min={0}
              max={24}
              placeholder="10"
              value={form.max_daily_service_hours}
              aria-invalid={Boolean(errors.max_daily_service_hours)}
              aria-describedby={
                errors.max_daily_service_hours ? `${serviceId}-error` : undefined
              }
              onChange={(e) => handleChange("max_daily_service_hours", e.target.value)}
            />
            {errors.max_daily_service_hours && (
              <p id={`${serviceId}-error`} className="mt-1 text-sm text-red-600" role="alert">
                {errors.max_daily_service_hours}
              </p>
            )}
          </div>

          {errors._cross && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errors._cross}
            </div>
          )}

          {errors._form && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errors._form}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={!canSubmit} aria-busy={submitting}>
            {submitting ? "Création…" : "Créer"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
