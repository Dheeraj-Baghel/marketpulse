import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MarketPulse", template: "%s · MarketPulse" },
  description: "Personal research workspace for companies listed on the National Stock Exchange of India.",
};

export const viewport: Viewport = {
  themeColor: "#F3F0EE",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
