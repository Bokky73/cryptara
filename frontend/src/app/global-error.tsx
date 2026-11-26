"use client";
import { ErrorRecoveryPanel, type ErrorRecoveryProps } from "@/components/ErrorRecoveryPanel";
export default function GlobalError(props: ErrorRecoveryProps) {
  return <html lang="en"><body style={{ margin: 0, padding: "2rem", background: "#111", color: "#fff", fontFamily: "sans-serif" }}><ErrorRecoveryPanel {...props} boundary="global" /></body></html>;
}
