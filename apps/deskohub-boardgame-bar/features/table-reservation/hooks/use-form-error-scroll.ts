import { useCallback, useEffect, useRef } from "react";
import type { FieldErrors } from "react-hook-form";

interface UseFormErrorScrollOptions {
  behavior?: ScrollBehavior;
  focusOnError?: boolean;
  block?: ScrollLogicalPosition;
}

export function useFormErrorScroll<T extends Record<string, unknown>>(
  errors: FieldErrors<T>,
  options: UseFormErrorScrollOptions = {}
) {
  const {
    behavior = "smooth",
    focusOnError = true,
    block = "center",
  } = options;

  const errorRefs = useRef<Record<string, HTMLElement | null>>({});
  const lastScrolledError = useRef<string | null>(null);

  // Register ref callback for each field
  const register = useCallback((fieldName: string) => {
    return (element: HTMLElement | null) => {
      if (element) {
        errorRefs.current[fieldName] = element;
        // Add data attribute for easier debugging
        element.setAttribute("data-error-field", fieldName);
      }
    };
  }, []);

  const scrollToElement = useCallback(
    (element: HTMLElement) => {
      // Use native scrollIntoView with options
      element.scrollIntoView({ behavior, block });

      const elementRect = element.getBoundingClientRect();
      const absoluteTop = elementRect.top + window.pageYOffset;
      // Get header height from --header-height CSS variable
      const headerHeight = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--header-height"
        ),
        10
      );
      const scrollPosition = absoluteTop - headerHeight - 20;

      // Fallback to window.scrollTo for exact positioning
      setTimeout(() => {
        window.scrollTo({
          top: scrollPosition,
          behavior,
        });
      }, 50);

      if (focusOnError) {
        // Find the first focusable element within the error container
        const focusableSelectors = [
          "input:not([disabled])",
          "select:not([disabled])",
          "textarea:not([disabled])",
          "button:not([disabled])",
          '[tabindex]:not([tabindex="-1"])',
        ].join(", ");

        const focusableElement = element.querySelector(
          focusableSelectors
        ) as HTMLElement;

        if (focusableElement) {
          // Delay focus to ensure scroll completes
          setTimeout(() => {
            focusableElement.focus({ preventScroll: true });
          }, 300);
        }
      }
    },
    [behavior, block, focusOnError]
  );

  // Scroll to first error when errors change
  useEffect(() => {
    const errorFields = Object.keys(errors);

    if (errorFields.length > 0) {
      const firstError = errorFields[0];

      // Avoid scrolling to same error repeatedly
      if (firstError && firstError !== lastScrolledError.current) {
        const element = errorRefs.current[firstError];

        if (element) {
          // Small delay to ensure DOM is updated
          requestAnimationFrame(() => {
            scrollToElement(element);
          });

          lastScrolledError.current = firstError;
        }
      }
    } else {
      lastScrolledError.current = null;
    }
  }, [errors, scrollToElement]);

  // Manual scroll function for specific fields
  const scrollToField = useCallback(
    (fieldName: string) => {
      const element = errorRefs.current[fieldName];
      if (element) {
        scrollToElement(element);
      }
    },
    [scrollToElement]
  );

  return {
    register,
    scrollToField,
    errorRefs: errorRefs.current,
  };
}
