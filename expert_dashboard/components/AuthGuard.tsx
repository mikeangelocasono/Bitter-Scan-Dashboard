"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "./UserContext";
import toast from "react-hot-toast";

const SUPPRESS_AUTH_TOAST_KEY = "bs:suppress-auth-toast";

export default function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, profile, loading } = useUser();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      let shouldSuppressToast = false;

      if (typeof window !== "undefined") {
        shouldSuppressToast = sessionStorage.getItem(SUPPRESS_AUTH_TOAST_KEY) === "true";
        if (shouldSuppressToast) {
          sessionStorage.removeItem(SUPPRESS_AUTH_TOAST_KEY);
        }
      }

      if (!shouldSuppressToast) {
        toast.error("Please log in to continue.");
      }

      router.replace("/login");
      return;
    }

    // Only check role if profile exists and is loaded
    if (profile && profile.role !== "expert") {
      toast.error("You are not allowed to log in here because your role does not match.");
      router.replace("/login");
    }
  }, [loading, user, profile, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-10 w-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  // Allow access if user exists and either no profile yet (still loading) or profile has expert role
  if (!user || (profile && profile.role !== "expert")) return null;
  return <>{children}</>;
}

