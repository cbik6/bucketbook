import {
  type AccountKind,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  type PdfCell,
  type PdfLine,
  type StatementResult,
  readStatement,
} from "@/lib/pdf-statement";
import { UserFacingError } from "../errors";

/**
 * Reads a statement PDF on this server with Mozilla's pdf.js. The file is
 * read in memory and never stored or sent anywhere.
 */

type TextItem = { str: string; transform: number[]; width: number; height: number };

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Run pdf.js's worker code in this process instead of spawning a worker.
  const g = globalThis as { pdfjsWorker?: unknown };
  g.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return pdfjs;
}

/** Groups a page's text into lines (same height on the page), then into cells (runs without a wide gap). */
export function toLines(page: number, items: TextItem[]): PdfLine[] {
  const words = items
    .filter((i) => i.str.trim() !== "")
    .map((i) => ({
      text: i.str,
      x: i.transform[4]!,
      y: i.transform[5]!,
      width: i.width,
      height: i.height || Math.abs(i.transform[3]!) || 8,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: (typeof words)[] = [];
  for (const w of words) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0]!.y - w.y) <= Math.max(2, w.height * 0.4)) row.push(w);
    else rows.push([w]);
  }

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const height = Math.max(...row.map((w) => w.height));
    const cells: PdfCell[] = [];
    for (const w of row) {
      const cell = cells[cells.length - 1];
      const gap = cell ? w.x - cell.right : Infinity;
      if (cell && gap < height * 0.9) {
        cell.text += gap > height * 0.12 && !cell.text.endsWith(" ") ? ` ${w.text}` : w.text;
        cell.right = Math.max(cell.right, w.x + w.width);
      } else cells.push({ x: w.x, right: w.x + w.width, text: w.text });
    }
    return { page, y: row[0]!.y, height, cells };
  });
}

export async function readPdfLines(bytes: Uint8Array): Promise<PdfLine[]> {
  if (bytes.byteLength > MAX_PDF_BYTES)
    throw new UserFacingError("That PDF is over 10 MB. Try one statement at a time.");
  if (new TextDecoder().decode(bytes.subarray(0, 1024)).indexOf("%PDF-") < 0)
    throw new UserFacingError("That file isn't a PDF.");
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy();
    if ((err as { name?: string }).name === "PasswordException")
      throw new UserFacingError(
        "That PDF is password protected. Save a copy without the password and try again.",
      );
    throw new UserFacingError("That PDF couldn't be read. It may be damaged.");
  }
  try {
    if (doc.numPages > MAX_PDF_PAGES)
      throw new UserFacingError(
        `That PDF has more than ${MAX_PDF_PAGES} pages. Try one statement at a time.`,
      );
    const lines: PdfLine[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      lines.push(
        ...toLines(
          n,
          content.items.flatMap((i) => ("str" in i ? [i] : [])),
        ),
      );
      page.cleanup();
    }
    return lines;
  } finally {
    await task.destroy();
  }
}

export async function readPdfStatement(
  bytes: Uint8Array,
  kind: AccountKind,
  today: string,
): Promise<StatementResult> {
  const lines = await readPdfLines(bytes);
  if (lines.length === 0)
    throw new UserFacingError(
      "That PDF has no text in it, so it is probably a scan. Download the statement from your bank's website instead.",
    );
  const result = readStatement(lines, kind, today);
  if (result.rows.length === 0)
    throw new UserFacingError(
      "No transactions were found in that PDF. If your bank offers a CSV download, import that instead.",
    );
  return result;
}
