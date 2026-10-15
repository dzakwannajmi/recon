import type { Metadata } from "next";
import { Nav } from "@/components/layout/nav";

export const metadata: Metadata = { title: "Agent | Recon" };

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      {children}
    </>
  );
}
