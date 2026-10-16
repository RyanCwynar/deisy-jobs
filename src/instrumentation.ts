export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  try {
    const { ensureSchema, getDb } = await import("@/lib/db");
    await ensureSchema(getDb());
  } catch (err) {
    console.error("[deisy-jobs] schema migration on start failed:", err);
  }
}
