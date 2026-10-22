import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/server";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Voice AI &amp; Call Intelligence Platform</h1>
      <p>Signed in. {user.permissions.length} permissions across {user.teamIds.length} team(s).</p>
      <LogoutButton />
    </main>
  );
}
