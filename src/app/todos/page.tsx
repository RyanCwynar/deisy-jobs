import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TodosView } from "@/components/TodosView";

export const dynamic = "force-dynamic";

export default async function TodosPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/todos");
  return <TodosView userName={session.name} />;
}
