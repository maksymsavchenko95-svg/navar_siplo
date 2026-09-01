import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Navar",
  description: "Weekly grocery planning agent on the Silpo MCP",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uk">
      <body
        style={{
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          maxWidth: 720,
          margin: "0 auto",
          padding: "2rem 1rem",
          lineHeight: 1.5,
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
