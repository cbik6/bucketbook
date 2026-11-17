/**
 * Next.js calls register() once when the server starts, and waits for it to
 * finish before serving requests. We use it to check config, run database
 * migrations and start the background job queue.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Never touch the database while `next build` prerenders pages.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startServer } = await import("./server/startup");
  await startServer();
}
