import { type Page, expect, test } from "@playwright/test";

/** Menus close once something in them is chosen, including links to other pages. */

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("pat@example.test");
  await page.getByLabel("Password").fill("a long test password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
}

test("menus: the book switcher closes after choosing", async ({ page }) => {
  await signIn(page);
  const switcher = page.getByRole("button", { name: /Example Family/ }).filter({ visible: true });

  await switcher.click();
  await page.getByRole("menuitem", { name: "All books" }).click();
  await expect(page).toHaveURL(/\/books$/);
  await expect(page.getByRole("menu")).toBeHidden();

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
  await switcher.click();
  await page.getByRole("menuitem", { name: /Example Family/ }).click();
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
});

test("menus: the account menu and Book settings show the version", async ({ page }) => {
  await signIn(page);
  const version = page.getByRole("menuitem", { name: /^Bucketbook version \d+\.\d+\.\d+/ });
  await page.getByRole("button", { name: /^Account:/ }).click();
  await expect(version).toBeVisible();
  await expect(version).toHaveAttribute("href", /CHANGELOG\.md$/);
  await page.keyboard.press("Escape");

  await expect(page.getByRole("menu")).toBeHidden();
  const bookUrl = new URL(page.url()).pathname.split("/").slice(0, 3).join("/");
  await page.goto(`${bookUrl}/settings`);
  await expect(page.getByText(/^Bucketbook version$/)).toBeVisible();
});
