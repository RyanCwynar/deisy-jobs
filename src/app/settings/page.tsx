import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { PasskeySettings } from "@/components/PasskeySettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/settings");

  return <PasskeySettings userName={session.name} />;
}
