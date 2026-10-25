import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createRef } from "react";
import { Annotation, validateSegment, VideoPlayer } from "./Annotation";
import { api, ApiError } from "./api";
import type { Task, User } from "./types";
const user: User = {
  id: "u",
  username: "标注员",
  tenantId: "t",
  role: "Annotator",
  isActive: true,
  mustChangePassword: false,
};
export const task: Task = {
  id: "task",
  tenantId: "t",
  name: "Push-T 机器人操作",
  instructions: "标记有效动作",
  videoUrl: "https://example.test/video.mp4",
  dueAtUtc: null,
  status: "Claimed",
  assigneeUserId: "u",
  latestSubmitterUserId: null,
  submittedAtUtc: null,
  version: 1,
  isOverdue: false,
  segments: [],
  videoBoundaryVerified: false,
};
const segment = {
  id: "s",
  taskId: "task",
  startMs: 1000,
  endMs: 2000,
  durationMs: 1000,
};
it("reports a stalled initial load and can retry the same source", () => {
  vi.useFakeTimers();
  try {
    const ref = createRef<HTMLVideoElement>();
    const onDuration = vi.fn();
    render(
      <VideoPlayer
        url={task.videoUrl}
        onDuration={onDuration}
        onPosition={vi.fn()}
        videoRef={ref}
      />,
    );
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByText(/视频加载超时/)).toBeVisible();
    expect(screen.getByRole("link", { name: "打开源视频" })).toHaveAttribute(
      "href",
      task.videoUrl,
    );
    const previous = ref.current;
    fireEvent.click(screen.getByRole("button", { name: "重试加载视频" }));
    expect(ref.current).not.toBe(previous);
    expect(screen.queryByText(/视频加载超时/)).not.toBeInTheDocument();
    Object.defineProperty(ref.current, "duration", { value: 10 });
    fireEvent.loadedMetadata(ref.current!);
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByText("视频时长已读取")).toBeVisible();
    expect(screen.queryByText(/视频加载超时/)).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
it("clears the previous video's duration and failure when the URL changes", () => {
  const ref = createRef<HTMLVideoElement>();
  const onDuration = vi.fn();
  const onPosition = vi.fn();
  const { rerender } = render(
    <VideoPlayer
      url={task.videoUrl}
      onDuration={onDuration}
      onPosition={onPosition}
      videoRef={ref}
    />,
  );
  Object.defineProperty(ref.current, "duration", { value: 10 });
  fireEvent.loadedMetadata(ref.current!);
  rerender(
    <VideoPlayer
      url="https://example.test/next.mp4"
      onDuration={onDuration}
      onPosition={onPosition}
      videoRef={ref}
    />,
  );
  expect(onDuration).toHaveBeenLastCalledWith(undefined);
  expect(onPosition).toHaveBeenLastCalledWith(0);
  expect(screen.queryByText("视频时长已读取")).not.toBeInTheDocument();
});
it("validates integer milliseconds, boundaries, overlap, duplicate, and adjacency", () => {
  expect(validateSegment(-1, 1, [], null)).toMatch(/非负/);
  expect(validateSegment(0.5, 1, [], null)).toMatch(/整数/);
  expect(validateSegment(1, 1, [], null)).toMatch(/小于/);
  expect(validateSegment(0, 2001, [], null, 2000)).toMatch(/超出/);
  expect(validateSegment(1000, 2000, [segment], null)).toMatch(/重叠/);
  expect(validateSegment(1500, 2500, [segment], null)).toMatch(/重叠/);
  expect(validateSegment(2000, 3000, [segment], null)).toBeNull();
  expect(validateSegment(5000, 9000, [], null)).toBeNull();
  expect(validateSegment(1000, 2000, [segment], "s")).toBeNull();
});
it("reads finite duration in rounded milliseconds and reports playback failure", () => {
  const onDuration = vi.fn();
  const onPosition = vi.fn();
  const ref = createRef<HTMLVideoElement>();
  render(
    <VideoPlayer
      url={task.videoUrl}
      onDuration={onDuration}
      onPosition={onPosition}
      videoRef={ref}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("正在加载视频");
  expect(screen.queryByText(/暂时无法读取视频总时长/)).not.toBeInTheDocument();
  Object.defineProperty(ref.current, "duration", {
    value: 12.3456,
    configurable: true,
  });
  fireEvent.loadedMetadata(ref.current!);
  expect(onDuration).toHaveBeenLastCalledWith(12346);
  expect(screen.getByText("视频时长已读取")).toBeInTheDocument();
  ref.current!.currentTime = 1.2346;
  fireEvent.timeUpdate(ref.current!);
  expect(onPosition).toHaveBeenCalledWith(1235);
  Object.defineProperty(ref.current, "duration", { value: Infinity });
  fireEvent.durationChange(ref.current!);
  expect(onDuration).toHaveBeenLastCalledWith(undefined);
  fireEvent.error(ref.current!);
  expect(screen.getByText(/视频播放失败/)).toBeInTheDocument();
  expect(
    screen.queryByText(/video_duration_unavailable/),
  ).not.toBeInTheDocument();
});
it("adds, edits and deletes stable segments using current version", async () => {
  const changed = vi.fn();
  const post = vi
    .spyOn(api, "post")
    .mockResolvedValue({ ...task, version: 2, segments: [segment] });
  const put = vi.spyOn(api, "put").mockResolvedValue({
    ...task,
    version: 3,
    segments: [{ ...segment, endMs: 2500, durationMs: 1500 }],
  });
  const del = vi
    .spyOn(api, "delete")
    .mockResolvedValue({ ...task, version: 4, segments: [] });
  const u = userEvent.setup();
  render(<Annotation initialTask={task} user={user} onChanged={changed} />);
  await u.clear(screen.getByLabelText("起点（毫秒）"));
  await u.type(screen.getByLabelText("起点（毫秒）"), "1000");
  await u.clear(screen.getByLabelText("终点（毫秒）"));
  await u.type(screen.getByLabelText("终点（毫秒）"), "2000");
  await u.click(screen.getByRole("button", { name: "添加片段" }));
  expect(post).toHaveBeenCalledWith("/tasks/task/segments", {
    startMs: 1000,
    endMs: 2000,
    expectedVersion: 1,
    videoDurationMs: undefined,
  });
  await u.click(await screen.findByRole("button", { name: "编辑" }));
  await u.clear(screen.getByLabelText("终点（毫秒）"));
  await u.type(screen.getByLabelText("终点（毫秒）"), "2500");
  await u.click(screen.getByRole("button", { name: "保存修改" }));
  expect(put).toHaveBeenCalledWith(
    "/tasks/task/segments/s",
    expect.objectContaining({ expectedVersion: 2, endMs: 2500 }),
  );
  await u.click(await screen.findByRole("button", { name: "删除片段 1" }));
  expect(del).toHaveBeenCalledWith("/tasks/task/segments/s", 3);
  expect(changed).toHaveBeenCalledTimes(3);
});
it("shows sorted segments and sums total; submission locks editor", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue({
    ...task,
    status: "Submitted",
    version: 2,
    segments: [segment],
  });
  const later = {
    ...segment,
    id: "later",
    startMs: 3000,
    endMs: 5000,
    durationMs: 2000,
  };
  render(
    <Annotation
      initialTask={{ ...task, segments: [later, segment] }}
      user={user}
      onChanged={() => {}}
    />,
  );
  expect(screen.getByText("00:00:03.000")).toBeInTheDocument();
  const buttons = screen
    .getAllByRole("button")
    .filter((b) => b.className === "segment-time");
  expect(within(buttons[0]).getByText(/00:00:01.000 —/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "提交标注" }));
  await userEvent.click(screen.getByRole("button", { name: "确认提交" }));
  expect(post).toHaveBeenCalledWith(
    "/tasks/task/submit",
    expect.objectContaining({ expectedVersion: 1 }),
  );
  expect(await screen.findByText(/已提交，标注内容已锁定/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "添加片段" }),
  ).not.toBeInTheDocument();
});
it("blocks empty submission and renders correction content editable", () => {
  const { rerender } = render(
    <Annotation initialTask={task} user={user} onChanged={() => {}} />,
  );
  expect(screen.getByRole("button", { name: "提交标注" })).toBeDisabled();
  rerender(
    <Annotation
      initialTask={{ ...task, status: "Correction", segments: [segment] }}
      user={user}
      onChanged={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "编辑" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "提交标注" })).toBeEnabled();
});
it("shows server conflict and reloads resource without automatically overwriting", async () => {
  vi.spyOn(api, "post").mockRejectedValue(
    new ApiError({
      title: "版本冲突",
      status: 409,
      code: "concurrency_conflict",
    }),
  );
  const get = vi
    .spyOn(api, "get")
    .mockResolvedValue({ ...task, status: "Cancelled", version: 2 });
  render(<Annotation initialTask={task} user={user} onChanged={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "添加片段" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "状态已变化，请刷新后重试",
  );
  await waitFor(() => expect(get).toHaveBeenCalledWith("/tasks/task"));
  expect(await screen.findByText("当前任务仅可查看。")).toBeInTheDocument();
});
