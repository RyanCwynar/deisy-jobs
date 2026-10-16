import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TokensAdmin } from "./TokensAdmin";

export const dynamic = "force-dynamic";

export default async function AdminTokensPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin/tokens");
  if (session.name !== "ryan") redirect("/");

  return <TokensAdmin />;
}
