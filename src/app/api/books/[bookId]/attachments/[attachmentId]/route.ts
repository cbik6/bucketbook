import { getCurrentUser } from "@/server/auth/session";
import { getAttachment, readAttachmentBytes } from "@/server/bank/attachments-service";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { UserFacingError } from "@/server/errors";

/**
 * Serves a receipt to someone who can see the book. Files are shown inline
 * (photos and PDFs open in the browser) and never run as a page: the type is
 * the one detected at upload, sniffing is off, and the sandbox blocks scripts.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/attachments/[attachmentId]">,
) {
  const { bookId, attachmentId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to see this file.", { status: 401 });
  try {
    await requireBookAccess(getDb(), user.id, bookId, "viewer");
    const row = await getAttachment(getDb(), bookId, attachmentId);
    const bytes = await readAttachmentBytes(row);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": row.contentType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    if (err instanceof UserFacingError) return new Response("Not found.", { status: 404 });
    throw err;
  }
}
