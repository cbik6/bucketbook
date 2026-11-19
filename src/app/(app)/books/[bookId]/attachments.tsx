"use client";

import { FileText, ImageIcon, Paperclip, X } from "lucide-react";
import { useId, useRef, useTransition } from "react";
import { toast } from "sonner";
import { buttonClass, PendingLabel } from "@/components/ui/button";
import { deleteAttachmentAction, uploadAttachmentsAction } from "./attachment-actions";

export type AttachmentInfo = { id: string; fileName: string; contentType: string };

/**
 * Receipts on a journal entry or a bank transaction: open in a new tab,
 * attach more (photos or PDFs up to 10 MB), or remove one.
 */
export function Attachments({
  bookId,
  target,
  files,
  canEdit,
  compact,
}: {
  bookId: string;
  target: { entryId: string } | { bankTransactionId: string };
  files: AttachmentInfo[];
  canEdit: boolean;
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  const upload = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const fd = new FormData();
    for (const f of Array.from(list)) {
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`${f.name} is over 10 MB. Try a smaller photo or a compressed PDF.`);
        return;
      }
      fd.append("files", f);
    }
    start(async () => {
      const r = await uploadAttachmentsAction(bookId, target, fd);
      if (r.ok) toast.success(list.length === 1 ? "Receipt attached." : "Receipts attached.");
      else toast.error(r.error);
      if (input.current) input.current.value = "";
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {!compact ? (
        <h3 id={`${id}-title`} className="text-[0.9375rem] font-semibold text-ink">
          Receipts
        </h3>
      ) : null}
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-labelledby={compact ? undefined : `${id}-title`}>
          {files.map((f) => (
            <li
              key={f.id}
              className="flex h-8 max-w-full items-center gap-1 rounded-full border border-rule bg-surface pl-3 pr-0.5 text-[0.8125rem]"
            >
              {f.contentType === "application/pdf" ? (
                <FileText size={14} aria-hidden className="shrink-0 text-ink-muted" />
              ) : (
                <ImageIcon size={14} aria-hidden className="shrink-0 text-ink-muted" />
              )}
              <a
                href={`/api/books/${bookId}/attachments/${f.id}`}
                target="_blank"
                rel="noreferrer"
                className="truncate text-signal-ink hover:underline"
              >
                {f.fileName}
              </a>
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`Remove ${f.fileName}`}
                  title="Remove"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await deleteAttachmentAction(bookId, f.id);
                      if (r.ok) toast.success("Receipt removed.");
                      else toast.error(r.error);
                    })
                  }
                  className="tap-target-y grid size-7 shrink-0 place-items-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink active:bg-sunken"
                >
                  <X size={13} aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : !compact ? (
        <p className="text-sm text-ink-muted">No receipts attached.</p>
      ) : null}
      {canEdit ? (
        <div>
          <label
            className={buttonClass(
              "secondary",
              "sm",
              "cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--focus)]",
            )}
            aria-disabled={pending || undefined}
          >
            <input
              ref={input}
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(e) => upload(e.target.files)}
            />
            <Paperclip size={14} aria-hidden />
            <PendingLabel pending={pending} label="Uploading">
              Attach receipt
            </PendingLabel>
          </label>
        </div>
      ) : null}
    </div>
  );
}
