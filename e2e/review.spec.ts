import { type Page, expect, test } from "@playwright/test";
import { clickSetupLink } from "./helpers";

/**
 * Phase 3 flow on the install that first-run.spec.ts set up: import bank CSV
 * files, match a transfer, approve with a category, save a rule, and see the
 * rule fill in the next import. Runs after ledger.spec.ts (name order).
 * SimpleFIN itself is covered by integration tests with a fake bridge, so
 * this test never touches the network.
 */

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("pat@example.test");
  await page.getByLabel("Password").fill("a long test password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
}

const today = new Date().toISOString().slice(0, 10);

async function importCsv(page: Page, account: string, csv: string, expectCount: number) {
  await page.getByRole("link", { name: "Import", exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "Import transactions" })).toBeVisible();
  await page
    .getByLabel("Account", { exact: true })
    .filter({ visible: true })
    .selectOption({ label: account });
  await page
    .locator('input[type="file"]')
    .filter({ visible: true })
    .setInputFiles({ name: "bank.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(
    page.getByText(`${expectCount} ${expectCount === 1 ? "row" : "rows"} read`),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check for duplicates" }).click();
  await page.getByRole("button", { name: `Send ${expectCount} to review` }).click();
  await expect(page.getByRole("heading", { name: "For review" })).toBeVisible();
}

test("review: CSV import, transfer match, approve, save a rule, rule suggests", async ({
  page,
}) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Book" }).first();
  await nav.getByRole("link", { name: /For review/ }).click();
  await expect(page.getByText("All caught up.")).toBeVisible();

  await importCsv(
    page,
    "Checking",
    `Date,Description,Amount\n${today},LOCAL GROCER #12,-42.10\n${today},PAYROLL ACME,1500.00\n${today},PAYMENT TO CARD,-200.00\n`,
    3,
  );
  await importCsv(
    page,
    "Credit Card",
    `Date,Description,Amount\n${today},PAYMENT THANK YOU,200.00\n`,
    1,
  );
  await expect(nav.getByRole("link", { name: /For review/ })).toContainText("4");

  // A card per bank account, with its own count; the search box narrows the list.
  const cards = page.getByRole("navigation", { name: "Bank accounts" }).filter({ visible: true });
  await expect(cards.getByRole("link", { name: /^Checking/ })).toContainText("3 to review");
  await expect(cards.getByRole("link", { name: /^Credit Card/ })).toContainText("1 to review");
  const search = page.getByRole("searchbox", { name: "Search transactions" });
  await expect(async () => {
    await search.fill("payroll");
    await expect(page.getByText("1 of 4")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.getByRole("listitem").filter({ hasText: "LOCAL GROCER #12" })).toHaveCount(0);
  await search.fill("");

  // The card payment pairs with the checking side and records both at once.
  const transfer = page.getByRole("listitem").filter({ hasText: "PAYMENT TO CARD" });
  await expect(transfer.getByLabel(/Category for/)).toHaveValue(/^transfer:/);
  await transfer.getByRole("button", { name: /Match PAYMENT TO CARD/ }).click();
  await expect(page.getByText("Transfer recorded.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "PAYMENT THANK YOU" })).toHaveCount(0);

  // Categorize the grocery run and save it as a rule.
  const grocery = page.getByRole("listitem").filter({ hasText: "LOCAL GROCER #12" });
  const category = grocery.getByLabel(/Category for/);
  const groceries = await category
    .locator("option", { hasText: /(^|: )Groceries$/ })
    .getAttribute("value");
  // Splitting can be backed out of from the same list.
  await category.selectOption("split");
  await expect(category.locator("option:checked")).toHaveText("Split into 2 lines");
  await category.selectOption(groceries!);
  await expect(category).toHaveValue(groceries!);
  // Splitting opened the details, so the rule checkbox is already showing.
  await grocery.getByLabel(/Always use this category/).check();
  await grocery.getByRole("button", { name: /Add LOCAL GROCER/ }).click();
  await expect(page.getByText("Added and saved as a rule.")).toBeVisible();

  // Paycheck with the keyboard: focus the row, then A approves.
  const pay = page.getByRole("listitem").filter({ hasText: "PAYROLL ACME" });
  const payCategory = pay.getByLabel(/Category for/);
  const paychecks = await payCategory
    .locator("option", { hasText: /(^|: )Paychecks$/ })
    .getAttribute("value");
  await payCategory.selectOption(paychecks!);
  await pay.focus();
  await page.keyboard.press("a");
  await expect(page.getByText("All caught up.")).toBeVisible();

  // The rule now suggests the category for the next grocery run.
  await importCsv(
    page,
    "Checking",
    `Date,Description,Amount\n${today},LOCAL GROCER #12,-55.25\n${today},LOCAL GROCER #12,-18.00\n`,
    2,
  );
  const next = page.getByRole("listitem").filter({ hasText: "$18.00" });
  await expect(next.getByText("Rule: LOCAL GROCER #12")).toBeVisible();
  await expect(next.getByLabel(/Category for/)).toHaveValue(groceries!);

  // Create a rule straight from a transaction, prefilled from it.
  await next.getByRole("button", { name: "LOCAL GROCER #12", exact: true }).click();
  await next.getByRole("button", { name: "Create a rule from this" }).click();
  await expect(next.getByRole("heading", { name: "New rule from this transaction" })).toBeVisible();
  await expect(next.getByLabel("Text to look for")).toHaveValue("LOCAL GROCER");
  await next.getByLabel("Name", { exact: true }).fill("Local Grocer, any store");
  await next.getByRole("button", { name: "Create rule" }).click();
  await expect(page.getByText(/Rule created/)).toBeVisible();

  // Select all and approve together.
  await page.getByLabel("Select all").check();
  await page.getByRole("button", { name: "Add 2" }).click();
  await expect(page.getByText("Added 2.")).toBeVisible();
  await expect(page.getByText("All caught up.")).toBeVisible();

  await page.getByRole("link", { name: "Posted" }).click();
  await expect(page.getByRole("cell", { name: "PAYMENT TO CARD", exact: true })).toBeVisible();

  // Rules page lists the saved rule; the book's bank connections offer SimpleFIN.
  await clickSetupLink(page, "Rules");
  await expect(page.getByText("LOCAL GROCER #12").first()).toBeVisible();
  await clickSetupLink(page, "Bank connections");
  await expect(page.getByRole("heading", { name: "Connect SimpleFIN" })).toBeVisible();
  // The old address still leads there.
  await page.goto("/connections");
  await expect(page).toHaveURL(/\/books\/[^/]+\/connections$/);
  await expect(page.getByRole("heading", { name: "Connect SimpleFIN" })).toBeVisible();
});
