import type { ReactNode } from "react";
import { ApiError } from "./api";
import type { Page, TaskStatus } from "./types";
export const statuses: Record<TaskStatus, string> = {
  Draft: "草稿",
  Available: "可领取",
  Claimed: "标注中",
  Submitted: "已提交",
  Correction: "待修正",
  Cancelled: "已取消",
};
export function duration(ms: number) {
  const hours = Math.floor(ms / 3600000),
    minutes = Math.floor(ms / 60000) % 60,
    seconds = Math.floor(ms / 1000) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
export function shanghai(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        dateStyle: "medium",
        timeStyle: "short",
        hour12: false,
      }).format(new Date(value))
    : "无截止时间";
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function Badge({ status }: { status: TaskStatus }) {
  return (
    <span className={`badge ${status.toLowerCase()}`}>{statuses[status]}</span>
  );
}
export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const problem = error instanceof ApiError ? error.problem : null;
  return (
    <div role="alert" className="notice error">
      <strong>
        {problem?.status === 409
          ? "状态已变化，请刷新后重试"
          : error instanceof Error
            ? error.message
            : "操作失败，请重试"}
      </strong>
      {problem && (
        <>
          <small>{problem.code}</small>
          {problem.errors &&
            Object.entries(problem.errors).map(([field, messages]) => (
              <div key={field}>
                {field}: {messages.join("；")}
              </div>
            ))}
          {problem.traceId && <small>追踪编号：{problem.traceId}</small>}
        </>
      )}
    </div>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Empty({ text = "暂无符合条件的记录" }: { text?: string }) {
  return (
    <div className="empty">
      <span>◇</span>
      <h3>{text}</h3>
      <p>调整筛选条件，或开始创建第一条记录。</p>
    </div>
  );
}
export function Pagination({
  data,
  onPage,
}: {
  data: Pick<Page<unknown>, "page" | "totalPages" | "totalItems">;
  onPage: (n: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        共 {data.totalItems} 条 · 第 {data.page} /{" "}
        {Math.max(1, data.totalPages)} 页
      </span>
      <div>
        <button disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>
          上一页
        </button>
        <button
          disabled={data.page >= data.totalPages}
          onClick={() => onPage(data.page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
