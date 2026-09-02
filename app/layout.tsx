import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Worker Welfare Assurance Platform",
  description: "Assessment platform for workforce welfare, onboarding, and accommodation reviews.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-ink">{children}</body>
    </html>
  );
}
