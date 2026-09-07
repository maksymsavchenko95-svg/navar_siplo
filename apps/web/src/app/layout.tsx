import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Manrope } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Navar",
  description: "Weekly grocery planning agent on the Silpo MCP",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uk" className={manrope.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
