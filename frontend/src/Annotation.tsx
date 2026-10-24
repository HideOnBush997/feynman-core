import { useEffect, useRef, useState } from "react";
import { Check, Plus, Scissors, Trash2 } from "lucide-react";
import { api } from "./api";
import type { Segment, Task, User } from "./types";
import { Badge, duration, ErrorMessage, Field, shanghai } from "./ui";
export function VideoPlayer({
  url,
  onDuration,
  onPosition,
  videoRef,
}: {
  url: string;
  onDuration: (ms: number | undefined) => void;
  onPosition: (ms: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [known, setKnown] = useState(false);
  const [failed, setFailed] = useState(false);
  const metadata = (video: HTMLVideoElement) => {
    const ms =
      Number.isFinite(video.duration) && video.duration > 0
        ? Math.round(video.duration * 1000)
        : undefined;
    setKnown(ms !== undefined);
    onDuration(ms);
  };
  return (
    <div className="player">
      <video
        ref={videoRef}
        key={url}
        src={url}
        controls
        preload="metadata"
        onLoadedMetadata={(e) => metadata(e.currentTarget)}
        onDurationChange={(e) => metadata(e.currentTarget)}
        onTimeUpdate={(e) =>
          onPosition(Math.round(e.currentTarget.currentTime * 1000))
        }
        onError={() => {
          setFailed(true);
          setKnown(false);
          onDuration(undefined);
        }}
      />
      <div className="player-caption">
        <span>源视频 · 浏览器直接播放</span>
        <span className={known ? "verified" : "warning"}>
          {known ? "视频时长已读取" : "视频边界未能校验"}
        </span>
      </div>
      {!known && (
        <p className="notice warning">
          {failed ? "视频播放失败。" : ""}
          无法获取视频总时长（video_duration_unavailable），可继续标注；仍校验正长度、重复和重叠。
        </p>
      )}
    </div>
  );
}
export function validateSegment(
  start: number,
  end: number,
  segments: Segment[],
  editingId: string | null,
  durationMs?: number,
) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < 0
  )
    return "起止时间必须为非负整数毫秒";
  if (start >= end) return "起点必须小于终点";
  if (durationMs !== undefined && end > durationMs) return "片段超出视频时长";
  if (
    segments.some(
      (s) => s.id !== editingId && start < s.endMs && end > s.startMs,
    )
  )
    return "片段不得重叠或完全重复，首尾相接合法";
  return null;
}
export function Annotation({
  initialTask,
  user,
  onChanged,
}: {
  initialTask: Task;
  user: User;
  onChanged: (task: Task) => void;
}) {
  const [task, setTask] = useState(initialTask);
  const [videoDurationMs, setDuration] = useState<number>();
  const [position, setPosition] = useState(0);
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("1000");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [success, setSuccess] = useState("");
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => setTask(initialTask), [initialTask]);
  const locked =
    user.role !== "Annotator" ||
    task.assigneeUserId !== user.id ||
    !["Claimed", "Correction"].includes(task.status);
  const segments = [...(task.segments || [])].sort(
    (a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id),
  );
  const total = segments.reduce((n, s) => n + s.durationMs, 0);
  const adopt = (next: Task) => {
    setTask(next);
    onChanged(next);
  };
  async function mutate(operation: () => Promise<Task>, message: string) {
    setBusy(true);
    setError(undefined);
    setSuccess("");
    try {
      adopt(await operation());
      setSuccess(message);
      setEditing(null);
      setConfirmSubmit(false);
    } catch (e) {
      setError(e);
      try {
        adopt(await api.get<Task>(`/tasks/${task.id}`));
      } catch {
        /* Keep the original write error visible. */
      }
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const validation = validateSegment(
      Number(start),
      Number(end),
      segments,
      editing,
      videoDurationMs,
    );
    if (validation) {
      setError(new Error(validation));
      return;
    }
    const body = {
      startMs: Number(start),
      endMs: Number(end),
      videoDurationMs,
      expectedVersion: task.version,
    };
    await mutate(
      () =>
        editing
          ? api.put<Task>(`/tasks/${task.id}/segments/${editing}`, body)
          : api.post<Task>(`/tasks/${task.id}/segments`, body),
      "片段已保存",
    );
  }
  return (
    <div className="annotation">
      <header className="detail-heading">
        <div>
          <div className="eyebrow">ANNOTATION STUDIO</div>
          <h2>{task.name}</h2>
          <p>
            {shanghai(task.dueAtUtc)}{" "}
            {task.isOverdue && (
              <span className="overdue">已逾期，仍可提交</span>
            )}
          </p>
        </div>
        <Badge status={task.status} />
      </header>
      {task.instructions && <p className="instructions">{task.instructions}</p>}
      {task.rejectionReason && (
        <p className="notice warning">退回说明：{task.rejectionReason}</p>
      )}
      <div className="studio-grid">
        <section>
          <VideoPlayer
            url={task.videoUrl}
            onDuration={setDuration}
            onPosition={setPosition}
            videoRef={videoRef}
          />
          <div className="position">
            <span>当前播放位置</span>
            <strong>{duration(position)}</strong>
            <button
              onClick={() => {
                if (videoRef.current)
                  videoRef.current.currentTime = Number(start) / 1000;
              }}
            >
              跳转到起点
            </button>
          </div>
        </section>
        <section className="segment-panel">
          <header>
            <div>
              <h3>
                <Scissors size={18} /> 片段列表
              </h3>
              <p>
                {segments.length} 个片段 · 总时长{" "}
                <strong>{duration(total)}</strong>
              </p>
            </div>
          </header>
          {locked && (
            <p className="notice">
              {task.status === "Submitted"
                ? "已提交，标注内容已锁定。需由管理员退回后修正。"
                : "当前任务仅可查看。"}
            </p>
          )}
          <ErrorMessage error={error} />
          {success && (
            <p role="status" className="notice success">
              {success}
            </p>
          )}
          <div className="segment-list">
            {!segments.length && (
              <p className="empty-inline">还没有片段，设置起止时间开始标注。</p>
            )}
            {segments.map((s, i) => (
              <div
                className={`segment ${editing === s.id ? "editing" : ""}`}
                key={s.id}
              >
                <span className="segment-index">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <button
                  className="segment-time"
                  onClick={() => {
                    if (videoRef.current)
                      videoRef.current.currentTime = s.startMs / 1000;
                  }}
                >
                  <strong>
                    {duration(s.startMs)} — {duration(s.endMs)}
                  </strong>
                  <small>{duration(s.durationMs)}</small>
                </button>
                {!locked && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setEditing(s.id);
                        setStart(String(s.startMs));
                        setEnd(String(s.endMs));
                      }}
                    >
                      编辑
                    </button>
                    <button
                      aria-label={`删除片段 ${i + 1}`}
                      disabled={busy}
                      onClick={() =>
                        mutate(
                          () =>
                            api.delete<Task>(
                              `/tasks/${task.id}/segments/${s.id}`,
                              task.version,
                            ),
                          "片段已删除",
                        )
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          {!locked && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <div className="form-row">
                  <Field label="起点（毫秒）">
                    <input
                      aria-label="起点（毫秒）"
                      type="number"
                      min="0"
                      step="1"
                      required
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                    />
                  </Field>
                  <Field label="终点（毫秒）">
                    <input
                      aria-label="终点（毫秒）"
                      type="number"
                      min="0"
                      step="1"
                      required
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </Field>
                </div>
                <div className="inline-actions">
                  <button
                    type="button"
                    onClick={() => setStart(String(position))}
                  >
                    当前位置设为起点
                  </button>
                  <button
                    type="button"
                    onClick={() => setEnd(String(position))}
                  >
                    设为终点
                  </button>
                </div>
                <button className="primary full" disabled={busy}>
                  <Plus size={16} />
                  {busy ? "保存中…" : editing ? "保存修改" : "添加片段"}
                </button>
                {editing && (
                  <button
                    type="button"
                    className="full"
                    onClick={() => setEditing(null)}
                  >
                    取消编辑
                  </button>
                )}
              </form>
              <p className="hint">每次变更立即保存 · 相邻片段允许首尾相接</p>
              <div className="submission">
                {confirmSubmit ? (
                  <>
                    <p>
                      确认提交 {segments.length}{" "}
                      个片段？提交后将锁定，计入本次提交日期统计。
                    </p>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        mutate(
                          () =>
                            api.post<Task>(`/tasks/${task.id}/submit`, {
                              expectedVersion: task.version,
                              videoDurationMs,
                            }),
                          "提交成功，片段已锁定",
                        )
                      }
                    >
                      <Check size={16} />
                      确认提交
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setConfirmSubmit(false)}
                    >
                      继续编辑
                    </button>
                  </>
                ) : (
                  <button
                    className="primary full"
                    disabled={busy || !segments.length}
                    onClick={() => setConfirmSubmit(true)}
                  >
                    <Check size={16} />
                    提交标注
                  </button>
                )}
                {!segments.length && (
                  <small>至少添加一个有效片段才能提交</small>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
