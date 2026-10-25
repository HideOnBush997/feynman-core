import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect } from "vitest";
import App, { Login } from "./App";
import { Management } from "./Management";
import { TaskForm, Tasks } from "./Tasks";
import { Statistics } from "./Statistics";
import { api, ApiError, sessionStore } from "./api";
import { ErrorMessage } from "./ui";
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

it.each(["tenant", "date"])(
  "does not show stale statistics after a %s filter fails and can retry",
  async (filter) => {
    let fail = true;
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path.startsWith("/tenants"))
        return page([
          { id: "a", name: "团队 A" },
          { id: "b", name: "团队 B" },
        ]);
      if (path.startsWith("/users")) return page([]);
      const params = new URLSearchParams(path.split("?")[1]);
      const changed =
        filter === "tenant"
          ? params.get("tenantId") === "b"
          : params.get("toDate") === "2030-01-01";
      if (changed && fail) throw new Error("无法连接服务");
      return changed
        ? { ...page([]), totalDurationMs: 0, days: [] }
        : {
            ...page([task]),
            totalDurationMs: 3000,
            days: [
              {
                date: "2026-10-25",
                durationMs: 3000,
                tenants: [
                  {
                    tenantId: "a",
                    tenantName: "先前明细租户",
                    durationMs: 3000,
                    annotators: [],
                  },
                ],
              },
            ],
          };
    });
    const { container } = render(<Statistics />);
    await waitFor(() =>
      expect(
        container.querySelector(".metric.dark > strong"),
      ).toHaveTextContent("00:00:03.000"),
    );
    if (filter === "tenant")
      await userEvent.selectOptions(
        screen.getByLabelText("租户", { exact: true }),
        "b",
      );
    else
      fireEvent.change(screen.getByLabelText("结束日期"), {
        target: { value: "2030-01-01" },
      });
    await screen.findByRole("alert");
    expect(container.querySelector(".metric.dark > strong")).toHaveTextContent(
      "—",
    );
    expect(screen.queryByText("先前明细租户")).not.toBeInTheDocument();
    expect(screen.queryByText("所选日期暂无有效提交")).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "重试查询" }));
    await screen.findByText("所选日期暂无有效提交");
    expect(container.querySelector(".metric.dark > strong")).toHaveTextContent(
      "00:00:00.000",
    );
  },
);

it.each([
  [
    "username_conflict",
    "Username already taken",
    "用户名已存在，请更换用户名。",
  ],
  [
    "segment_overlap",
    "片段不能重叠，首尾相接允许。",
    "片段不能重叠，首尾相接允许。",
  ],
  ["concurrency_conflict", "Conflict", "状态已变化，请刷新后重试"],
])("explains the actual %s conflict", (code, detail, expected) => {
  render(
    <ErrorMessage
      error={new ApiError({ status: 409, code, title: code, detail })}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(expected);
});

it("keeps the tenant name of accounts whose inactive tenant is absent from selector options", async () => {
  vi.spyOn(api, "get").mockImplementation(async (path) =>
    path.startsWith("/tenants")
      ? page([])
      : page([
          {
            ...user,
            role: "Annotator",
            tenantId: "inactive",
            tenantName: "已停用无任务团队",
          },
        ]),
  );
  render(<Management kind="users" />);
  expect(
    await screen.findByRole("cell", { name: "已停用无任务团队" }),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "创建账号" }));
  expect(
    within(screen.getByRole("dialog")).queryByRole("option", {
      name: "已停用无任务团队",
    }),
  ).not.toBeInTheDocument();
});
it("preserves deadline seconds when saving an existing draft", async () => {
  const patch = vi.spyOn(api, "patch").mockResolvedValue(task);
  render(
    <TaskForm
      task={{ ...task, dueAtUtc: "2026-10-24T00:15:37Z" }}
      tenants={[
        { id: "t", name: "团队", isActive: true } as import("./types").Tenant,
      ]}
      onSaved={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  expect(patch).toHaveBeenCalledWith(
    "/tasks/task",
    expect.objectContaining({ dueAtLocal: "2026-10-24T08:15:37" }),
  );
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
it("does not apply a hidden mine-status filter to available tasks", async () => {
  mockLists();
  render(<Tasks user={{ ...user, role: "Annotator", tenantId: "t" }} />);
  await userEvent.click(screen.getByRole("button", { name: "我的任务" }));
  await userEvent.selectOptions(screen.getByLabelText("任务状态"), "Submitted");
  await userEvent.click(screen.getByRole("button", { name: "可领取任务" }));
  await waitFor(() => {
    const paths = vi.mocked(api.get).mock.calls.map(([path]) => path);
    const last = paths
      .filter((path) => path.startsWith("/tasks/available"))
      .at(-1)!;
    expect(new URLSearchParams(last.split("?")[1]).has("status")).toBe(false);
  });
});
it("login updates the active session", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: "token",
          expiresAtUtc: "2030-01-01",
          user,
        }),
      ),
    ),
  );
  render(<Login />);
  await userEvent.type(screen.getByLabelText("用户名"), "admin");
  await userEvent.type(screen.getByLabelText("密码"), "Test1!");
  await userEvent.click(screen.getByRole("button", { name: "进入工作台" }));
  await waitFor(() => expect(sessionStore.get()?.user.id).toBe(user.id));
  expect(fetch).toHaveBeenCalledWith(
    "/api/v1/auth/login",
    expect.objectContaining({ credentials: "include" }),
  );
});
it("login shows only the friendly error without diagnostic fields", () => {
  render(
    <Login
      initialError={
        new ApiError({
          title: "invalid_credentials",
          detail: "用户名或密码错误。",
          code: "invalid_credentials",
          status: 401,
          traceId: "internal-trace",
          errors: { request: ["用户名或密码错误。"] },
        })
      }
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe("用户名或密码错误。");
  expect(
    screen.queryByText(/invalid_credentials|internal-trace|追踪编号|request:/),
  ).not.toBeInTheDocument();
});
it("restored legacy password flags do not interrupt the workspace", async () => {
  mockLists();
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
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "任务管理" }),
  ).toBeVisible();
  expect(screen.queryByText("设置你的新密码")).not.toBeInTheDocument();
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
  await userEvent.type(
    screen.getByLabelText("密码", { exact: true }),
    "123456",
  );
  await userEvent.click(screen.getByRole("button", { name: "确认创建" }));
  expect(post).toHaveBeenCalledWith("/users", {
    username: "新标注员",
    role: "Annotator",
    tenantId: "t",
    temporaryPassword: "123456",
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
