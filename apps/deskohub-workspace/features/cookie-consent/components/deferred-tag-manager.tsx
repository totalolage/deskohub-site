"use client";

import { useEffect } from "react";
import { scheduleTagManagerLoad } from "../utils/tag-manager";

type DeferredTagManagerProps = {
  gtmId: string;
};

export function DeferredTagManager({ gtmId }: DeferredTagManagerProps) {
  useEffect(() => scheduleTagManagerLoad(gtmId), [gtmId]);

  return null;
}
