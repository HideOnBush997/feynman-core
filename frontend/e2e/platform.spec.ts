import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import { loadEnv } from "vite";
const testEnv = { ...loadEnv("e2e", process.cwd(), ""), ...process.env };
const screenshotDir =
  process.env.E2E_SCREENSHOT_DIR || "D:/Codex/Outputs/feynman-platform";
fs.mkdirSync(screenshotDir, { recursive: true });
const adminName = testEnv.E2E_ADMIN_USERNAME || "demo.admin";
const adminPassword = testEnv.E2E_ADMIN_PASSWORD || "";
const temporary = "123456";
type Identity = {
  token: string;
  user: { id: string; tenantId: string | null; mustChangePassword?: boolean };
};
async function auth(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<Identity> {
  const response = await request.post("/api/v1/auth/login", {
    data: { username, password },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const data = await response.json();
  return { token: data.accessToken, user: data.user };
}
async function call(
  request: APIRequestContext,
  identity: Identity,
  method: string,
  path: string,
  body?: unknown,
) {
  return request.fetch(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${identity.token}` },
    data: body,
  });
}
async function create(
  request: APIRequestContext,
  identity: Identity,
  path: string,
  body: unknown,
) {
  const response = await call(request, identity, "POST", path, body);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.status() === 204 ? undefined : response.json();
}
test.beforeAll(async ({ request }) => {
  if (!adminPassword)
    throw new Error("Set E2E_ADMIN_PASSWORD or use ignored .env.e2e.local.");
  const response = await request.post("/api/v1/auth/login", {
    data: { username: adminName, password: adminPassword },
  });

  expect(response.ok(), await response.text()).toBeTruthy();
  const session = await response.json();
  expect(session.user.mustChangePassword).toBe(false);
});
async function uiLogin(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(
    page.getByRole("heading", { name: /任务管理|标注工作台/ }),
  ).toBeVisible();
}
async function openTask(page: Page, name: string) {
  const card = page
    .locator("article.task-card")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
  await card.getByRole("button", { name: "打开任务" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
test("login errors show only the readable message", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("用户名", { exact: true })
    .fill(`missing-${Date.now()}`);
  await page.getByLabel("密码", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByRole("alert")).toHaveText("用户名或密码错误。");
  await page.screenshot({ path: `${screenshotDir}/login-friendly-error.png` });
});

test("complete admin → annotator → correction → statistics workflow in real UI", async ({
  page,
}) => {
  const suffix = Date.now();
  const tenantName = `E2E 租户 ${suffix}`;
  const username = `e2e-user-${suffix}`;
  const taskName = `E2E 机器人任务 ${suffix}`;
  await uiLogin(page, adminName, adminPassword);
  await page.getByRole("button", { name: "租户管理", exact: true }).click();
  await page.getByRole("button", { name: "创建租户", exact: true }).click();
  await page.getByLabel("租户名称").fill(tenantName);
  await page.getByRole("button", { name: "确认创建" }).click();
  await expect(page.getByRole("status")).toContainText("租户已创建");
  await page.getByRole("button", { name: "账号管理", exact: true }).click();
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("所属租户").selectOption({ label: tenantName });
  await page.getByLabel("密码", { exact: true }).fill(temporary);
  await page.getByRole("button", { name: "确认创建" }).click();
  await expect(page.getByRole("status")).toContainText("账号已创建");
  await page.getByRole("button", { name: "任务管理", exact: true }).click();
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await page.getByLabel("任务名称").fill(taskName);
  await page.getByLabel("所属租户").selectOption({ label: tenantName });
  await page
    .getByLabel("公开视频直链")
    .fill("https://example.invalid/unavailable.mp4");
  await page.getByLabel("标注说明").fill("标出有效动作");
  await page
    .getByLabel("截止时间（Asia/Shanghai，可选）")
    .fill("2020-01-01T09:00");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await page.getByLabel("搜索任务").fill(taskName);
  const card = page.locator("article.task-card").filter({ hasText: taskName });
  await card.getByRole("button", { name: "编辑草稿" }).click();
  await page.getByLabel("标注说明").fill("调整后说明");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await card.getByRole("button", { name: "发布", exact: true }).click();
  await page.getByRole("button", { name: "确认操作" }).click();
  await expect(card.getByText("可领取", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await uiLogin(page, username, temporary);
  await page.getByLabel("搜索任务").fill(taskName);
  await page.getByRole("button", { name: "领取任务", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "操作已完成" }),
  ).toContainText("操作已完成");
  await page.getByRole("button", { name: "我的任务", exact: true }).click();
  await openTask(page, taskName);
  await expect(page.getByText(/暂时无法读取视频总时长/)).toBeVisible();
  await page.getByLabel("起点（毫秒）").fill("0");
  await page.getByLabel("终点（毫秒）").fill("1500");
  await page.getByRole("button", { name: "添加片段" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "片段已保存" }),
  ).toContainText("片段已保存");
  await page.getByLabel("起点（毫秒）").fill("1500");
  await page.getByLabel("终点（毫秒）").fill("2500");
  await page.getByRole("button", { name: "添加片段" }).click();
  await expect(page.getByRole("button", { name: "删除片段 2" })).toBeVisible();
  await page.screenshot({
    path: `${screenshotDir}/annotation-workspace.png`,
    fullPage: false,
  });
  const desktop = page.viewportSize()!;
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page
      .locator(".detail-overlay")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.locator(".segment-panel").screenshot({
    path: `${screenshotDir}/annotation-editor-mobile.png`,
  });
  await page.setViewportSize(desktop);
  await page.getByRole("button", { name: "提交标注", exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByText(/已提交，标注内容已锁定/)).toBeVisible();
  await page.getByRole("button", { name: "返回任务列表" }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await uiLogin(page, adminName, adminPassword);
  await page.getByLabel("搜索任务").fill(taskName);
  await card.getByRole("button", { name: "退回修正" }).click();
  await page.getByLabel("退回说明").fill("请修正第二段");
  await page.getByRole("button", { name: "确认操作" }).click();
  await expect(card.getByText("待修正", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "取消任务" })).toHaveCount(0);
  await page.getByRole("button", { name: "工作量统计", exact: true }).click();
  await page
    .getByLabel("租户", { exact: true })
    .selectOption({ label: tenantName });
  await expect(page.locator(".metric.dark > strong")).toHaveText(
    "00:00:00.000",
  );
  await expect(
    page.getByRole("heading", { name: "所选日期暂无有效提交" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await uiLogin(page, username, temporary);
  await page.getByRole("button", { name: "我的任务", exact: true }).click();
  await page.getByLabel("搜索任务").fill(taskName);
  await openTask(page, taskName);
  await expect(page.getByRole("button", { name: "删除片段 2" })).toBeVisible();
  await page.getByRole("button", { name: "删除片段 2" }).click();
  await page.getByRole("button", { name: "提交标注", exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByText(/已提交，标注内容已锁定/)).toBeVisible();
  await page.getByRole("button", { name: "返回任务列表" }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await uiLogin(page, adminName, adminPassword);
  await page.getByRole("button", { name: "工作量统计", exact: true }).click();
  await page
    .getByLabel("租户", { exact: true })
    .selectOption({ label: tenantName });
  await expect(page.getByText("00:00:01.500").first()).toBeVisible();
  await page.locator("summary").filter({ hasText: tenantName }).click();
  await page.locator("summary").filter({ hasText: username }).click();
  await page.locator("summary").filter({ hasText: taskName }).click();
  await expect(page.getByText(/片段 1 ·/)).toBeVisible();
  await page.screenshot({
    path: `${screenshotDir}/admin-statistics.png`,
    fullPage: false,
  });
});
test("statistics hides old tenant totals on network failure and retries the selected query", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const admin = await auth(request, adminName, adminPassword);
  const tenant = await create(request, admin, "/tenants", {
    name: `统计回归 A ${suffix}`,
  });
  const empty = await create(request, admin, "/tenants", {
    name: `统计回归 B ${suffix}`,
  });
  const username = `stats-${suffix}`;
  await create(request, admin, "/users", {
    username,
    role: "Annotator",
    tenantId: tenant.id,
    temporaryPassword: temporary,
  });
  const annotator = await auth(request, username, temporary);
  let task = await create(request, admin, "/tasks", {
    tenantId: tenant.id,
    name: `统计回归 ${suffix}`,
    videoUrl: "https://example.invalid/video.mp4",
  });
  task = await create(request, admin, `/tasks/${task.id}/publish`, {
    expectedVersion: task.version,
  });
  task = await create(request, annotator, `/tasks/${task.id}/claim`, {
    expectedVersion: task.version,
  });
  task = await create(request, annotator, `/tasks/${task.id}/segments`, {
    startMs: 0,
    endMs: 3000,
    expectedVersion: task.version,
  });
  await create(request, annotator, `/tasks/${task.id}/submit`, {
    expectedVersion: task.version,
  });
  await uiLogin(page, adminName, adminPassword);
  await page.getByRole("button", { name: "工作量统计", exact: true }).click();
  await page.getByLabel("租户", { exact: true }).selectOption(tenant.id);
  const total = page.locator(".metric.dark > strong");
  await expect(total).toHaveText("00:00:03.000");
  let offline = true;
  await page.route("**/api/v1/statistics/daily?**", (route) =>
    offline ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.getByLabel("租户", { exact: true }).selectOption(empty.id);
  await expect(page.getByRole("alert")).toContainText("无法连接服务");
  await expect(total).toHaveText("—");
  await expect(page.locator(".stats-tree")).toHaveCount(0);
  await expect(page.getByText("统计暂时无法加载")).toBeVisible();
  await page.screenshot({
    path: `${screenshotDir}/fixed-statistics-error.png`,
  });
  offline = false;
  await page.getByRole("button", { name: "重试查询" }).click();
  await expect(total).toHaveText("00:00:00.000");
  await expect(page.getByText("所选日期暂无有效提交")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("account management preserves inactive tenant names and explains duplicate usernames", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const admin = await auth(request, adminName, adminPassword);
  const tenant = await create(request, admin, "/tenants", {
    name: `已停用空租户 ${suffix}`,
  });
  const username = `inactive-tenant-${suffix}`;
  await create(request, admin, "/users", {
    username,
    role: "Annotator",
    tenantId: tenant.id,
    temporaryPassword: temporary,
  });
  await create(request, admin, `/tenants/${tenant.id}/deactivate`, {});
  await uiLogin(page, adminName, adminPassword);
  await page.getByRole("button", { name: "账号管理", exact: true }).click();
  await page.getByLabel("搜索账号").fill(username);
  await expect(
    page.getByRole("cell", { name: tenant.name, exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${screenshotDir}/fixed-account-tenant.png` });
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("option", { name: tenant.name, exact: true }),
  ).toHaveCount(0);
  await dialog.getByLabel("用户名", { exact: true }).fill(adminName);
  await dialog.getByLabel("账号角色").selectOption("PlatformAdmin");
  await dialog.getByLabel("密码", { exact: true }).fill(temporary);
  await dialog.getByRole("button", { name: "确认创建" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "用户名已存在，请更换用户名。",
  );
  await expect(dialog.getByRole("alert")).not.toContainText("状态已变化");
  await page.screenshot({
    path: `${screenshotDir}/fixed-duplicate-username.png`,
  });
});

test("real API enforces concurrent claim, cross-tenant isolation, state transitions and immediate disable", async ({
  request,
}) => {
  const suffix = Date.now();
  const admin = await auth(request, adminName, adminPassword);
  const tenant = await create(request, admin, "/tenants", {
    name: `API ${suffix}`,
  });
  const foreign = await create(request, admin, "/tenants", {
    name: `Foreign ${suffix}`,
  });
  const ids: Identity[] = [];
  for (let i = 0; i < 3; i++) {
    const username = `race-${suffix}-${i}`;
    await create(request, admin, "/users", {
      username,
      role: "Annotator",
      tenantId: i === 2 ? foreign.id : tenant.id,
      temporaryPassword: temporary,
    });
    const initial = await auth(request, username, temporary);
    ids.push(initial);
  }
  const draft = await create(request, admin, "/tasks", {
    tenantId: tenant.id,
    name: `Race ${suffix}`,
    videoUrl: "https://example.invalid/video.mp4",
    dueAtLocal: "2020-01-01T00:00:00",
  });
  let task = await create(request, admin, `/tasks/${draft.id}/publish`, {
    expectedVersion: draft.version,
  });
  expect(task.isOverdue).toBe(true);
  const attempts = await Promise.all(
    ids.slice(0, 2).map((id) =>
      call(request, id, "POST", `/tasks/${task.id}/claim`, {
        expectedVersion: task.version,
      }),
    ),
  );
  expect(attempts.filter((r) => r.ok())).toHaveLength(1);
  const winner = ids[attempts[0].ok() ? 0 : 1];
  task = await attempts.find((r) => r.ok())!.json();
  for (const [method, path, body] of [
    ["GET", `/tasks/${task.id}`, undefined],
    ["POST", `/tasks/${task.id}/claim`, { expectedVersion: task.version }],
    [
      "POST",
      `/tasks/${task.id}/segments`,
      { startMs: 0, endMs: 1000, expectedVersion: task.version },
    ],
    ["POST", `/tasks/${task.id}/submit`, { expectedVersion: task.version }],
  ] as const) {
    const response = await call(request, ids[2], method, path, body);
    expect(response.status()).toBe(404);
  }
  const empty = await call(
    request,
    winner,
    "POST",
    `/tasks/${task.id}/submit`,
    { expectedVersion: task.version },
  );
  expect(empty.status()).toBe(409);
  task = await create(request, winner, `/tasks/${task.id}/segments`, {
    startMs: 0,
    endMs: 1000,
    expectedVersion: task.version,
  });
  expect(task.videoBoundaryVerified).toBe(false);
  const overlap = await call(
    request,
    winner,
    "POST",
    `/tasks/${task.id}/segments`,
    { startMs: 500, endMs: 1200, expectedVersion: task.version },
  );
  expect(overlap.status()).toBe(409);
  task = await create(request, winner, `/tasks/${task.id}/submit`, {
    expectedVersion: task.version,
  });
  expect(
    (
      await call(request, admin, "POST", `/tasks/${task.id}/cancel`, {
        expectedVersion: task.version,
      })
    ).status(),
  ).toBe(409);
  task = await create(request, admin, `/tasks/${task.id}/reject`, {
    expectedVersion: task.version,
  });
  expect(task.segments).toHaveLength(1);
  expect(
    (
      await call(request, admin, "POST", `/tasks/${task.id}/cancel`, {
        expectedVersion: task.version,
      })
    ).status(),
  ).toBe(409);
  const next = ids.find(
    (id) => id.user.tenantId === tenant.id && id.user.id !== winner.user.id,
  )!;
  task = await create(request, admin, `/tasks/${task.id}/reassign`, {
    assigneeUserId: next.user.id,
    expectedVersion: task.version,
  });
  task = await create(request, admin, `/tasks/${task.id}/recall`, {
    expectedVersion: task.version,
  });
  expect(task.status).toBe("Available");
  const denied = await call(
    request,
    winner,
    "POST",
    `/tasks/${task.id}/segments`,
    { startMs: 2000, endMs: 3000, expectedVersion: task.version },
  );
  expect([403, 409]).toContain(denied.status());
  task = await create(request, next, `/tasks/${task.id}/claim`, {
    expectedVersion: task.version,
  });
  task = await create(request, next, `/tasks/${task.id}/return`, {
    expectedVersion: task.version,
  });
  expect(task.status).toBe("Available");
  expect(task.segments).toHaveLength(1);
  task = await create(request, next, `/tasks/${task.id}/claim`, {
    expectedVersion: task.version,
  });
  task = await create(request, admin, `/tasks/${task.id}/cancel`, {
    expectedVersion: task.version,
  });
  expect(task.status).toBe("Cancelled");
  expect(task.assigneeUserId).toBeNull();
  const cancelDraft = await create(request, admin, "/tasks", {
    tenantId: tenant.id,
    name: `Cancel draft ${suffix}`,
    videoUrl: "https://example.invalid/v.mp4",
  });
  expect(
    (
      await create(request, admin, `/tasks/${cancelDraft.id}/cancel`, {
        expectedVersion: cancelDraft.version,
      })
    ).status,
  ).toBe("Cancelled");
  const availableDraft = await create(request, admin, "/tasks", {
    tenantId: tenant.id,
    name: `Cancel available ${suffix}`,
    videoUrl: "https://example.invalid/v.mp4",
  });
  const available = await create(
    request,
    admin,
    `/tasks/${availableDraft.id}/publish`,
    { expectedVersion: availableDraft.version },
  );
  expect(
    (
      await create(request, admin, `/tasks/${available.id}/cancel`, {
        expectedVersion: available.version,
      })
    ).status,
  ).toBe("Cancelled");
  await create(request, admin, `/users/${winner.user.id}/deactivate`, {});
  expect((await call(request, winner, "GET", "/tasks/mine")).status()).toBe(
    403,
  );
  await create(request, admin, `/tenants/${tenant.id}/deactivate`, {});
  expect((await call(request, next, "GET", "/tasks/mine")).status()).toBe(403);
});
