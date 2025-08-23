"use client";

import { RefreshCw, Settings2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  clearAllFeatureFlagOverridesAction,
  getAllFeatureFlagOverridesAction,
  setFeatureFlagOverrideAction,
} from "@/features/feature-flags/actions/feature-flag-actions";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { Separator } from "@/shared/components/ui/separator";
import {
  FEATURE_FLAGS_LIST,
  type FeatureFlagKey,
  type FeatureFlagOverride,
  MANUAL_BUCKETING_USER_IDS,
} from "@/shared/config/feature-flags";
import { isDev } from "@/shared/utils/environment";

interface FeatureFlagControlProps {
  flagKey: FeatureFlagKey;
  label: string;
  description: string;
  currentOverride: FeatureFlagOverride;
  onOverrideChange: (key: FeatureFlagKey, value: FeatureFlagOverride) => void;
}

function FeatureFlagControl({
  flagKey,
  label,
  description,
  currentOverride,
  onOverrideChange,
}: FeatureFlagControlProps) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (value: string) => {
    let overrideValue: FeatureFlagOverride;
    if (value === "default") {
      overrideValue = null;
    } else if (value === "enabled") {
      overrideValue = "true";
    } else {
      overrideValue = "false";
    }

    startTransition(() => {
      onOverrideChange(flagKey, overrideValue);
    });
  };

  const currentValue =
    currentOverride === null
      ? "default"
      : currentOverride === "true"
        ? "enabled"
        : "disabled";

  const badgeText =
    currentOverride === null
      ? "Default"
      : currentOverride === "true"
        ? "Enabled"
        : "Disabled";

  return (
    <div
      className={`space-y-2 p-4 border rounded-lg ${isPending ? "opacity-50" : ""}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <Label htmlFor={flagKey} className="text-base font-medium">
            {label}
          </Label>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <Badge
          variant={
            currentOverride === null
              ? "outline"
              : currentOverride === "true"
                ? "default"
                : "secondary"
          }
        >
          {badgeText}
        </Badge>
      </div>
      <RadioGroup
        value={currentValue}
        onValueChange={handleChange}
        disabled={isPending}
      >
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="default" id={`${flagKey}-default`} />
          <Label htmlFor={`${flagKey}-default`} className="text-sm">
            Default (Use Statsig)
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="enabled" id={`${flagKey}-enabled`} />
          <Label htmlFor={`${flagKey}-enabled`} className="text-sm">
            Force Enable ({MANUAL_BUCKETING_USER_IDS.OPTIN})
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="disabled" id={`${flagKey}-disabled`} />
          <Label htmlFor={`${flagKey}-disabled`} className="text-sm">
            Force Disable ({MANUAL_BUCKETING_USER_IDS.OPTOUT})
          </Label>
        </div>
      </RadioGroup>
    </div>
  );
}

export function FeatureFlagDebugger() {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<
    Partial<Record<FeatureFlagKey, "true" | "false">>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Load overrides when dialog opens
  useEffect(() => {
    if (open) {
      loadOverrides();
    }
  }, [open]);

  const loadOverrides = async () => {
    setIsLoading(true);
    const result = await getAllFeatureFlagOverridesAction();
    if (result.success) {
      setOverrides(result.overrides);
    }
    setIsLoading(false);
  };

  const handleOverrideChange = async (
    key: FeatureFlagKey,
    value: FeatureFlagOverride
  ) => {
    const result = await setFeatureFlagOverrideAction(key, value);
    if (result.success) {
      // Update local state
      setOverrides((prev) => {
        const updated = { ...prev };
        if (value === null) {
          delete updated[key];
        } else {
          updated[key] = value;
        }
        return updated;
      });
      // Refresh the page to apply changes
      router.refresh();
    }
  };

  const handleClearAll = () => {
    startTransition(async () => {
      const result = await clearAllFeatureFlagOverridesAction();
      if (result.success) {
        setOverrides({});
        router.refresh();
      }
    });
  };

  const isDevelopment = isDev();
  const activeOverridesCount = Object.keys(overrides).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="fixed bottom-4 right-4 z-50 shadow-lg"
          title="Feature Flag Debugger"
        >
          <Settings2 className="h-4 w-4" />
          {activeOverridesCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
              {activeOverridesCount}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Feature Flag Debugger</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadOverrides}
                disabled={isLoading || isPending}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAll}
                disabled={activeOverridesCount === 0 || isPending}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            </div>
          </DialogTitle>
          <DialogDescription>
            {isDevelopment ? (
              <span className="text-amber-600 font-medium">
                ⚠️ Development Mode: All feature flags use "developer" userID.
                Cookie overrides are disabled.
              </span>
            ) : (
              <>
                Override feature flags for testing. Changes apply immediately
                without page reload.
                {activeOverridesCount > 0 && (
                  <span className="ml-2 font-medium">
                    ({activeOverridesCount} override
                    {activeOverridesCount !== 1 ? "s" : ""} active)
                  </span>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <Separator />
        <ScrollArea className="h-[60vh] pr-4">
          <div className="space-y-4">
            {isDevelopment ? (
              <div className="text-center py-8">
                <div className="p-6 bg-amber-50 border-2 border-amber-200 rounded-lg">
                  <h3 className="text-lg font-semibold text-amber-900 mb-2">
                    Development Mode Active
                  </h3>
                  <p className="text-amber-700">
                    Feature flag overrides are disabled in development.
                    <br />
                    All flags use the "developer" userID for consistent testing.
                  </p>
                  <p className="text-sm text-amber-600 mt-4">
                    Deploy to staging or production to test cookie-based
                    overrides.
                  </p>
                </div>
              </div>
            ) : isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading feature flags...
              </div>
            ) : (
              FEATURE_FLAGS_LIST.map((flag) => (
                <FeatureFlagControl
                  key={flag.key}
                  flagKey={flag.key}
                  label={flag.label}
                  description={flag.description}
                  currentOverride={overrides[flag.key] ?? null}
                  onOverrideChange={handleOverrideChange}
                />
              ))
            )}
          </div>
        </ScrollArea>
        <Separator />
        <div className="p-4 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground">
            <strong>How it works:</strong>{" "}
            {isDevelopment ? (
              <>
                In development mode, all feature flags use the{" "}
                <code className="px-1 py-0.5 bg-background rounded">
                  developer
                </code>{" "}
                userID for consistent testing. Cookie-based overrides are
                disabled. Deploy to staging or production to test manual
                bucketing.
              </>
            ) : (
              <>
                Feature flag overrides are stored in cookies with the prefix
                "FF_". When set to "true", the system uses the{" "}
                <code className="px-1 py-0.5 bg-background rounded">
                  {MANUAL_BUCKETING_USER_IDS.OPTIN}
                </code>{" "}
                user ID (always enrolled). When set to "false", it uses{" "}
                <code className="px-1 py-0.5 bg-background rounded">
                  {MANUAL_BUCKETING_USER_IDS.OPTOUT}
                </code>{" "}
                (always excluded). These special users bypass normal Statsig
                bucketing.
              </>
            )}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
