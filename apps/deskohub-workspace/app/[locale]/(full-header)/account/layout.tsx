import type { ReactNode } from "react";

type AccountLayoutProps = {
  readonly children: ReactNode;
  readonly modal: ReactNode;
};

export default function AccountLayout({ children, modal }: AccountLayoutProps) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
