"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/shared/components/ui/button";

type AccessCodeDigitsProps = {
  readonly code: string;
  readonly className?: string;
};

export function AccessCodeDigits({ code, className }: AccessCodeDigitsProps) {
  return (
    <output
      aria-label={Array.from(code).join(" ")}
      className={`${className ?? "flex flex-wrap gap-2"} ph-no-capture`}
      data-ph-mask=""
      data-ph-no-capture=""
    >
      {Array.from(code).map((character, index) => (
        <span
          aria-hidden="true"
          className="grid h-14 w-10 place-items-center rounded-xl bg-navy-blue/5 font-mono text-2xl font-medium tabular-nums text-navy-blue ph-no-capture"
          // biome-ignore lint/suspicious/noArrayIndexKey: Access-code characters are positional and may repeat.
          key={`${index}-${character}`}
        >
          {character}
        </span>
      ))}
    </output>
  );
}

export function AccessCodeCopyButton({ code }: { readonly code: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      onClick={() => {
        void navigator.clipboard
          ?.writeText(code)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
      type="button"
      variant="secondary"
    >
      {copied ? (
        <Check aria-hidden className="size-4" />
      ) : (
        <Copy aria-hidden className="size-4" />
      )}
      {copied ? "Copied" : "Copy code"}
    </Button>
  );
}
