"use client";
import { LogOut } from "lucide-react";
import { Button } from "./ui/button";

export function LogoutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
    >
      <LogOut className="h-4 w-4" aria-hidden /> Sign out
    </Button>
  );
}
