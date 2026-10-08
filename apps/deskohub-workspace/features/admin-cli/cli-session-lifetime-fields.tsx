"use client";

import { useId, useState } from "react";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  cliSessionLifetimeAmountLimits,
  cliSessionLifetimeUnits,
} from "./contracts";

export function CliSessionLifetimeFields() {
  const amountId = useId();
  const unitId = useId();
  const neverExpireId = useId();
  const [neverExpire, setNeverExpire] = useState(false);

  return (
    <fieldset className="mb-5 grid gap-3">
      <legend className="mb-3 text-sm font-semibold">
        Keep this CLI authenticated for
      </legend>
      <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,12rem)] gap-3">
        <div className="grid gap-1.5">
          <Label className="sr-only" htmlFor={amountId}>
            Duration
          </Label>
          <Input
            defaultValue={30}
            disabled={neverExpire}
            id={amountId}
            inputMode="numeric"
            max={cliSessionLifetimeAmountLimits.maximum}
            min={cliSessionLifetimeAmountLimits.minimum}
            name="lifetimeAmount"
            required
            step={1}
            type="number"
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="sr-only" htmlFor={unitId}>
            Unit
          </Label>
          <Select
            defaultValue="days"
            disabled={neverExpire}
            name="lifetimeUnit"
          >
            <SelectTrigger id={unitId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cliSessionLifetimeUnits.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {
                    {
                      hours: "Hours",
                      days: "Days",
                      weeks: "Weeks",
                      months: "Months",
                      years: "Years",
                    }[unit]
                  }
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Checkbox
          checked={neverExpire}
          id={neverExpireId}
          name="neverExpire"
          onCheckedChange={(checked) => setNeverExpire(checked === true)}
        />
        <Label htmlFor={neverExpireId}>Never expire</Label>
      </div>
    </fieldset>
  );
}
