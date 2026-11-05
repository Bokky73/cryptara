import { AppShell } from "@/components/AppShell";
import { ReservePlanner } from "@/components/research/reserve-planner/ReservePlanner";

export const metadata = { title: "Reserve planner | Cryptara" };

export default function ReservePlannerPage() {
  return <AppShell><ReservePlanner /></AppShell>;
}
