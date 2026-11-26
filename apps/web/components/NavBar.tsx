import React from "react";
import Link from "next/link";
import { useAuth } from "../app/context/AuthContext";

export const NavBar: React.FC = () => {
  const { user, logout } = useAuth();
  if (!user) return null;
  const links = [
    { href: "/dashboard/admin", label: "Admin", role: "admin" },
    { href: "/dashboard/hospital", label: "Hospital", role: "hospital" },
    { href: "/dashboard/blood-bank", label: "Blood Bank", role: "blood_bank" },
    { href: "/dashboard/analytics", label: "Analytics", role: "admin" },
  ];
  return (
    <nav className="bg-white border-b p-4 flex justify-between items-center">
      <div className="flex space-x-4">
        {links
          .filter((l) => l.role === user.role || user.role === "admin")
          .map((l) => (
            <Link key={l.href} href={l.href} className="text-gray-700 hover:text-blue-600">
              {l.label}
            </Link>
          ))}
      </div>
      <button onClick={logout} className="text-red-600 hover:underline">Logout</button>
    </nav>
  );
};
