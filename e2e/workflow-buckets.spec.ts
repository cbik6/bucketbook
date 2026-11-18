import { type Page, expect, test } from "@playwright/test";

/**
 * Phase 4 flow on the install the earlier specs set up: turn on buckets for
 * Savings, add an allocation rule, approve a deposit that the rule splits,
 * and move money between buckets. Runs last (name order).
 */

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("pat@example.test");
  await page.getByLabel("Password").fill("a long test password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
}

const today = new Date().toISOString().slice(0, 10);
const label = (page: Page, text: string) =>
  page.getByLabel(text, { exact: true }).filter({ visible: true });

test("buckets: turn on, allocate a deposit, move money", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Book" }).first();
  await nav.getByRole("link", { name: "Buckets" }).click();
  await expect(page.getByRole("heading", { name: "Buckets", exact: true })).toBeVisible();

  const savings = page
    .getByRole("listitem")
    .filter({ hasText: "Savings" })
    .filter({ visible: true });
  await savings.getByRole("button", { name: "Turn on buckets" }).click();
  await label(page, "Start with these buckets").fill("Car, Trip");
  // Turning on buckets can't be undone, so it is press and hold.
  const hold = page.getByRole("button", { name: /Turn on buckets for Savings/ });
  await hold.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(1500);
  await page.keyboard.up("Space");
  await expect(page.getByText("Buckets are on.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Car", exact: true })).toBeVisible();

  // Half of every deposit goes to Car.
  await page.getByRole("button", { name: "Add a rule" }).click();
  await label(page, "Bucket").selectOption({ label: "Car" });
  await label(page, "Percent").fill("50");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("50% of each deposit to Car")).toBeVisible();

  // A deposit into Savings, approved from review.
  await nav.getByRole("link", { name: /For review/ }).click();
  await page.getByRole("link", { name: "Import CSV" }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "Import CSV" })).toBeVisible();
  await page
    .getByLabel("Account", { exact: true })
    .filter({ visible: true })
    .selectOption({ label: "Savings" });
  await page
    .locator('input[type="file"]')
    .filter({ visible: true })
    .setInputFiles({
      name: "savings.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`Date,Description,Amount\n${today},INTEREST PAYMENT,1000.00\n`),
    });
  await page.getByRole("button", { name: "Check for duplicates" }).click();
  await page.getByRole("button", { name: "Send 1 to review" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "INTEREST PAYMENT" });
  await expect(row.getByLabel(/Bucket it goes to/)).toHaveValue(/.+/);
  const category = row.getByLabel(/Category for/);
  const interest = await category
    .locator("option", { hasText: /(^|: )Interest Earned$/ })
    .getAttribute("value");
  await category.selectOption(interest!);
  await row.getByRole("button", { name: /Approve INTEREST PAYMENT/ }).click();
  await expect(page.getByText("Approved.")).toBeVisible();

  await nav.getByRole("link", { name: "Buckets" }).click();
  const car = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Car" }) });
  await expect(car).toContainText("$500.00");

  await page.getByRole("button", { name: "Move money" }).click();
  await page
    .getByLabel("To", { exact: true })
    .filter({ visible: true })
    .selectOption({ label: "Trip" });
  await label(page, "Amount").fill("120");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Moved.")).toBeVisible();
  const trip = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Trip" }) });
  await expect(trip).toContainText("$120.00");
});
