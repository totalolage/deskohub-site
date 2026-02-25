"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";

interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const SafeAreaContext = createContext<SafeAreaInsets>({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

export const useSafeArea = () => useContext(SafeAreaContext);

export function SafeAreaProvider({ children }: { children: ReactNode }) {
  const [insets, setInsets] = useState<SafeAreaInsets>({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });

  const [debugMode, setDebugMode] = useState(false);

  useEffect(() => {
    // For iOS devices using env() CSS variables
    const computeInsets = () => {
      if (
        typeof window !== "undefined" &&
        window.CSS &&
        CSS.supports("padding-top: env(safe-area-inset-top)")
      ) {
        // Get computed values from a temporary element
        const tempEl = document.createElement("div");
        tempEl.style.paddingTop = "env(safe-area-inset-top)";
        tempEl.style.paddingRight = "env(safe-area-inset-right)";
        tempEl.style.paddingBottom = "env(safe-area-inset-bottom)";
        tempEl.style.paddingLeft = "env(safe-area-inset-left)";
        document.body.appendChild(tempEl);

        const computedStyle = window.getComputedStyle(tempEl);
        setInsets({
          top: parseInt(computedStyle.paddingTop, 10) || 0,
          right: parseInt(computedStyle.paddingRight, 10) || 0,
          bottom: parseInt(computedStyle.paddingBottom, 10) || 0,
          left: parseInt(computedStyle.paddingLeft, 10) || 0,
        });

        document.body.removeChild(tempEl);
      }
    };

    computeInsets();
    window.addEventListener("resize", computeInsets);
    window.addEventListener("orientationchange", computeInsets);

    return () => {
      window.removeEventListener("resize", computeInsets);
      window.removeEventListener("orientationchange", computeInsets);
    };
  }, []);

  useEffect(() => {
    // Toggle debug with keyboard shortcut (Alt+Shift+D)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key === "D") {
        setDebugMode((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <SafeAreaContext.Provider value={insets}>
      {children}
      {debugMode && (
        <>
          <div
            className="fixed top-0 left-0 right-0 bg-red-500 opacity-50 pointer-events-none z-[9999]"
            style={{ height: `${insets.top}px` }}
          />
          <div
            className="fixed bottom-0 left-0 right-0 bg-red-500 opacity-50 pointer-events-none z-[9999]"
            style={{ height: `${insets.bottom}px` }}
          />
          <div
            className="fixed top-0 left-0 bottom-0 bg-red-500 opacity-50 pointer-events-none z-[9999]"
            style={{ width: `${insets.left}px` }}
          />
          <div
            className="fixed top-0 right-0 bottom-0 bg-red-500 opacity-50 pointer-events-none z-[9999]"
            style={{ width: `${insets.right}px` }}
          />
          <div className="fixed top-2 left-2 bg-black text-white text-xs px-2 py-1 rounded z-[10000] pointer-events-none">
            Safe Area Debug: T:{insets.top} R:{insets.right} B:{insets.bottom}{" "}
            L:{insets.left}
          </div>
        </>
      )}
    </SafeAreaContext.Provider>
  );
}
