import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect } from "vitest";
import App, { Login, PasswordChange } from "./App";
import { Management } from "./Management";
import { Tasks } from "./Tasks";
import { Statistics } from "./Statistics";
import { api, sessionStore } from "./api";
import type { Task, User } from "./types";
const user: User = {
  id: "u",
  username: "admin",
  role: "PlatformAdmin",
  tenantId: null,
  isActive: true,
  mustChangePassword: false,
};
const task: Task = {
  id: "task",
  tenantId: "t",
  name: "测试机器人",
  videoUrl: "https://example.test/video.mp4",
  instructions: null,
  dueAtUtc: "2020-01-01T00:00:00Z",
  status: "Draft",
  assigneeUserId: null,
  latestSubmitterUserId: null,
  submittedAtUtc: null,
  version: 3,
  isOverdue: true,
  segments: [],
  videoBoundaryVerified: false,
};
const page = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 20,
  totalItems: items.length,
  totalPages: items.length ? 1 : 0,
});
it("restoration network failure stays visible on login", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("无法连接服务");
  expect(screen.getByRole("button", { name: "进入工作台" })).toBeVisible();
});
it("expected missing cookie restores clean anonymous login", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ title: "未登录", code: "refresh_token_invalid" }),
          { status: 401 },
        ),
      ),
  );
  render(<App />);
  expect(
    await screen.findByRole("button", { name: "进入工作台" }),
  ).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
function mockLists(tasks: Task[] = []) {
  vi.spyOn(api, "get").mockImplementation(async (path) =>
    path.startsWith("/tenants")
      ? page([{ id: "t", name: "示教团队", isActive: true }])
      : path.startsWith("/users")
        ? page([{ ...user, role: "Annotator", tenantId: "t" }])
        : path === "/tasks/task"
          ? task
          : page(tasks),
  );
}
it("login presents errors and first-password state from server", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: "token",
          expiresAtUtc: "2030-01-01",
          user: { ...user, mustChangePassword: true },
        }),
      ),
    ),
  );
  render(<Login />);
  await userEvent.type(screen.getByLabelText("用户名"), "admin");
  await userEvent.type(screen.getByLabelText("密码"), "Test1!");
  await userEvent.click(screen.getByRole("button", { name: "进入工作台" }));
  await waitFor(() =>
    expect(sessionStore.get()?.user.mustChangePassword).toBe(true),
  );
  expect(fetch).toHaveBeenCalledWith(
    "/api/v1/auth/login",
    expect.objectContaining({ credentials: "include" }),
  );
});
it("password confirmation prevents mismatching submission", async () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<PasswordChange />);
  await userEvent.type(screen.getByLabelText("当前临时密码"), "Old1!x");
  await userEvent.type(screen.getByLabelText("新密码"), "New1!x");
  await userEvent.type(screen.getByLabelText("确认新密码"), "New2!x");
  await userEvent.click(screen.getByRole("button", { name: "更新密码并继续" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("不一致");
  expect(fetch).not.toHaveBeenCalled();
});
it("admin creates tenants and deactivates with explicit confirmation", async () => {
  mockLists();
  const post = vi.spyOn(api, "post").mockResolvedValue({});
  render(<Management kind="tenants" />);
  await screen.findByText("示教团队");
  await userEvent.click(screen.getByRole("button", { name: "创建租户" }));
  await userEvent.type(screen.getByLabelText("租户名称"), "新团队");
  await userEvent.click(screen.getByRole("button", { name: "确认创建" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/tenants", { name: "新团队" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "停用" }));
  await userEvent.click(screen.getByRole("button", { name: "确认停用" }));
  expect(post).toHaveBeenCalledWith("/tenants/t/deactivate");
});
it("admin creates annotator account bound to tenant", async () => {
  mockLists();
  const post = vi.spyOn(api, "post").mockResolvedValue({});
  render(<Management kind="users" />);
  await userEvent.click(screen.getByRole("button", { name: "创建账号" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("用户名"), "新标注员");
  await userEvent.selectOptions(within(dialog).getByLabelText("所属租户"), "t");
  await userEvent.type(screen.getByLabelText("临时密码"), "Temp123!");
  await userEvent.click(screen.getByRole("button", { name: "确认创建" }));
  expect(post).toHaveBeenCalledWith("/users", {
    username: "新标注员",
    role: "Annotator",
    tenantId: "t",
    temporaryPassword: "Temp123!",
  });
});
it("draft creation passes Shanghai local time and publication uses server version", async () => {
  mockLists([task]);
  const post = vi
    .spyOn(api, "post")
    .mockResolvedValue({ ...task, status: "Available", version: 4 });
  render(<Tasks user={user} />);
  await userEvent.click(await screen.findByRole("button", { name: "发布" }));
  await userEvent.click(screen.getByRole("button", { name: "确认操作" }));
  expect(post).toHaveBeenCalledWith("/tasks/task/publish", {
    expectedVersion: 3,
  });
  await userEvent.click(screen.getByRole("button", { name: "创建任务" }));
  await userEvent.type(screen.getByLabelText("任务名称"), "新任务");
  await userEvent.selectOptions(screen.getByLabelText("所属租户"), "t");
  await userEvent.type(
    screen.getByLabelText("公开视频直链"),
    "https://example.test/push.mp4",
  );
  await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  expect(post).toHaveBeenCalledWith(
    "/tasks",
    expect.objectContaining({
      name: "新任务",
      tenantId: "t",
      dueAtLocal: null,
    }),
  );
});
it("submitted and correction tasks cannot be cancelled; correction can be reassigned", async () => {
  mockLists([
    { ...task, id: "submitted", status: "Submitted" },
    { ...task, id: "correction", status: "Correction" },
  ]);
  render(<Tasks user={user} />);
  await screen.findByRole("button", { name: "退回修正" });
  expect(
    screen.queryByRole("button", { name: "取消任务" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "改派" })).toBeInTheDocument();
});
it("annotator can claim overdue task and never requests admin resources", async () => {
  const get = vi
    .spyOn(api, "get")
    .mockResolvedValue(page([{ ...task, status: "Available" }]));
  const post = vi
    .spyOn(api, "post")
    .mockResolvedValue({ ...task, status: "Claimed" });
  render(<Tasks user={{ ...user, role: "Annotator", tenantId: "t" }} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "领取任务" }),
  );
  expect(post).toHaveBeenCalledWith("/tasks/task/claim", {
    expectedVersion: 3,
  });
  expect(get.mock.calls.every(([path]) => path.startsWith("/tasks"))).toBe(
    true,
  );
  expect(screen.getByText("逾期")).toBeInTheDocument();
});
it("statistics expands date, tenant, annotator, task and segments", async () => {
  vi.spyOn(api, "get").mockImplementation(async (path) =>
    path.startsWith("/statistics")
      ? {
          ...page([task]),
          totalDurationMs: 1500,
          days: [
            {
              date: "2026-10-24",
              durationMs: 1500,
              tenants: [
                {
                  tenantId: "t",
                  tenantName: "示教团队",
                  durationMs: 1500,
                  annotators: [
                    {
                      annotatorId: "u",
                      username: "标注员甲",
                      durationMs: 1500,
                      tasks: [
                        {
                          ...task,
                          durationMs: 1500,
                          segments: [
                            {
                              id: "s",
                              startMs: 0,
                              endMs: 1500,
                              durationMs: 1500,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }
      : page([]),
  );
  render(<Statistics />);
  await screen.findByText("示教团队");
  await userEvent.click(screen.getByText("示教团队"));
  await userEvent.click(screen.getByText("标注员甲"));
  await userEvent.click(screen.getByText("测试机器人"));
  expect(screen.getByText(/片段 1 ·/)).toBeVisible();
  expect(screen.getAllByText("00:00:01.500").length).toBeGreaterThan(1);
});
