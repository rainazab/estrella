import "./globals.css";
import type { Metadata } from "next";
import TopBar from "../components/TopBar";

export const metadata: Metadata = {
  title: "LineWise — El Prat planning",
  description: "Execution-intelligence cockpit for Damm canning lines 14, 17 and 19.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <TopBar />
        {children}
      </body>
    </html>
  );
}
