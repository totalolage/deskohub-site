import { Check, X } from "lucide-react";

/** The check or cross shown at the end of a validated phone input. */
export function PhoneValidityIcon({ isValid }: { isValid: boolean }) {
  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2">
      {isValid ? (
        <Check
          className="h-4 w-4 text-green-500"
          aria-label="Valid phone number"
        />
      ) : (
        <X className="h-4 w-4 text-red-500" aria-label="Invalid phone number" />
      )}
    </div>
  );
}
