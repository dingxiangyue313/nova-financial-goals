import { expect, test } from "@playwright/test";

test("创建目标、选择方案、激活并预览显著支出的调整", async ({ page }) => {
  const session = `goal-first-${crypto.randomUUID()}`;
  await page.addInitScript(value => localStorage.setItem("nova_fusion_session", value), session);
  await page.goto("/");
  await expect(page.getByTestId("twin-sync")).toHaveAttribute("data-twin-version", /^[1-9]\d*$/);

  await page.getByRole("button", { name: /创建目标/ }).first().click();
  await page.locator("textarea").first().fill("我想在2027年5月1日去日本旅行，预算10000元，不能动应急金");
  await page.getByRole("button", { name: /解析目标并查看可行性/ }).click();
  await expect(page.getByRole("button", { name: "生成审批快照" })).toBeVisible();
  await page.getByRole("button", { name: "生成审批快照" }).click();
  await page.getByRole("button", { name: "确认参数并执行" }).click();

  await expect(page.getByText("目标草案尚未创建。")).toHaveCount(0);
  await expect(page.locator('[data-schema-status="valid"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /先选择方案/ })).toBeDisabled();
  await page.getByRole("button", { name: "选择平衡" }).click();
  await expect(page.getByRole("button", { name: "已选择平衡" })).toBeVisible();
  await page.getByRole("button", { name: /确认并激活/ }).click();
  await expect(page.getByRole("heading", { name: "早上好，Alex" })).toBeVisible();

  await page.getByRole("button", { name: /模拟支出/ }).click();
  const expense = page.locator('input[type="range"]');
  await expense.focus();
  await expense.press("End");
  await expect(page.getByRole("heading", { name: /可能延期/ })).toBeVisible();
  await page.getByRole("button", { name: /Scenario B/ }).click();
  await page.getByRole("button", { name: "查看延期调整并确认" }).click();
  await expect(page.getByRole("heading", { name: "请确认最终操作" })).toBeVisible();
  await page.getByRole("button", { name: "确认参数并执行" }).click();
  await expect(page.getByRole("heading", { name: /的可行性/ })).toBeVisible();
});
