"use client";
import { useEffect } from "react";

export function ErrorReporter() {
  useEffect(() => {
    function handleError(event: ErrorEvent) {
      const payload = {
        route: window.location.pathname,
        method: "GET",
        errorMessage: event.message ?? "Unhandled error",
        errorStack: event.error?.stack ?? null,
        requestBody: null,
        requestHeaders: null,
        userAgent: navigator.userAgent,
        ip: null,
      };
      void fetch("/api/errors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(() => {});
    }
    function handleRejection(event: PromiseRejectionEvent) {
      const payload = {
        route: window.location.pathname,
        method: "GET",
        errorMessage: "Unhandled promise rejection: " + String(event.reason),
        errorStack: event.reason instanceof Error ? event.reason.stack : null,
        requestBody: null,
        requestHeaders: null,
        userAgent: navigator.userAgent,
        ip: null,
      };
      void fetch("/api/errors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(() => {});
    }
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);
  return null;
}