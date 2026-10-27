import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Fluid Wallet — local-first LLM wallet for web AI apps",
  description:
    "An open protocol and browser wallet that lets web AI apps use your own model credentials without ever touching them.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
