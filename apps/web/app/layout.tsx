import "./globals.css";
import { AuthProvider } from "./context/AuthContext";
import React from "react";
import { NavBar } from "../components/NavBar";

export const metadata = {
  title: "BloodNet AI",
  description: "Predictive Blood Supply & Shortage Management System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <AuthProvider><NavBar />{children}</AuthProvider>
      </body>
    </html>
  );
}
