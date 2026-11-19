import { type Page, expect, test } from "@playwright/test";
import { makePdf } from "../tests/make-pdf";

/**
 * Imports a made-up credit card statement PDF: the server reads it, the
 * preview shows charges as money out and the payment as money in, and the
 * rows land in For review tagged PDF.
 */

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("pat@example.test");
  await page.getByLabel("Password").fill("a long test password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
}

const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * 86_400_000);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
};

// The test book starts today, so the rows are dated today.
function statement() {
  const line = (y: number, date: string, text: string, amount: string) => [
    { x: 50, y, text: date },
    { x: 130, y, text },
    { x: 540 - amount.length * 5, y, text: amount },
  ];
  return makePdf([
    [
      { x: 50, y: 740, text: `Statement period ${daysAgo(20)} - ${daysAgo(0)}` },
      { x: 50, y: 700, text: "Date" },
      { x: 130, y: 700, text: "Description" },
      { x: 510, y: 700, text: "Amount" },
      ...line(685, daysAgo(0), "PDF TEST HARDWARE", "45.00"),
      ...line(670, daysAgo(0), "PDF TEST PAYMENT THANK YOU", "-300.00"),
    ],
  ]);
}

test("PDF statement: read, preview, send to review", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Book" }).first();
  await nav.getByRole("link", { name: "For review" }).click();
  await page.getByRole("link", { name: "Import", exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "Import transactions" })).toBeVisible();
  await page.getByRole("link", { name: "PDF statement" }).click();

  const main = page.locator("main").filter({ visible: true });
  // Earlier pages stay in the DOM, hidden, so pick the visible controls.
  const label = (text: string) => page.getByLabel(text, { exact: true }).filter({ visible: true });
  // Choosing before the page is interactive is lost, so retry until the hint changes.
  await expect(async () => {
    await label("Account").selectOption({ label: "Credit Card" });
    await expect(page.getByText(/never stored or sent anywhere/)).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByLabel("PDF statement", { exact: true }).setInputFiles({
    name: "statement.pdf",
    mimeType: "application/pdf",
    buffer: statement(),
  });
  await expect(main.getByText("2 transactions found")).toBeVisible();
  const hardware = main.getByRole("row").filter({ hasText: "PDF TEST HARDWARE" });
  await expect(hardware).toContainText("-$45.00");
  const payment = main.getByRole("row").filter({ hasText: "PDF TEST PAYMENT" });
  await expect(payment).toContainText("$300.00");
  await expect(payment).not.toContainText("-$300.00");
  await page.screenshot({ path: "test-results/pdf-import.png", fullPage: true });

  await main.getByRole("button", { name: "Check for duplicates" }).click();
  await main.getByRole("button", { name: "Send 2 to review" }).click();
  await expect(page.getByRole("heading", { name: "For review" })).toBeVisible();
  await expect(page.getByText("Imported 2 transactions.")).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: "PDF TEST HARDWARE" }).first();
  await expect(item).toContainText("PDF");
});
