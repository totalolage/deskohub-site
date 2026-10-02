"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useTransition,
} from "react";

export type CustomerFilterNavigationState = {
  readonly isFilterNavigationPending: boolean;
  readonly startFilterNavigation: (navigate: () => void) => void;
};

const defaultCustomerFilterNavigation: CustomerFilterNavigationState = {
  isFilterNavigationPending: false,
  startFilterNavigation: (navigate) => navigate(),
};

export const CustomerFilterNavigationContext =
  createContext<CustomerFilterNavigationState>(defaultCustomerFilterNavigation);

export function useCustomerFilterNavigation() {
  return useContext(CustomerFilterNavigationContext);
}

export function CustomerFilterNavigationProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [isFilterNavigationPending, startTransition] = useTransition();

  const startFilterNavigation = (navigate: () => void) => {
    startTransition(() => navigate());
  };

  return (
    <CustomerFilterNavigationContext
      value={{ isFilterNavigationPending, startFilterNavigation }}
    >
      {children}
    </CustomerFilterNavigationContext>
  );
}
