import { useEffect, useRef, type ReactNode } from "react";
import { Inbox, X, ChevronLeft, ChevronRight } from "lucide-react";
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
  const message =
    problem?.code === "username_conflict"
      ? "用户名已存在，请更换用户名。"
      : problem &&
          [
            "concurrency_conflict",
            "task_state_conflict",
            "task_already_claimed",
          ].includes(problem.code)
        ? "状态已变化，请刷新后重试"
        : error instanceof Error
          ? error.message
          : "操作失败，请重试";
  return (
    <div role="alert" className="notice error">
      <strong>{message}</strong>
      {problem?.errors &&
        [...new Set(Object.values(problem.errors).flat())]
          .filter(
            (message) =>
              message !== (error instanceof Error ? error.message : undefined),
          )
          .map((message) => <div key={message}>{message}</div>)}
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
export function Empty({
  text = "暂无符合条件的记录",
  hint = "试试调整筛选条件，或稍后再来查看。",
}: {
  text?: string;
  hint?: string;
}) {
  return (
    <div className="empty">
      <span>
        <Inbox size={28} aria-hidden="true" />
      </span>
      <h3>{text}</h3>
      <p>{hint}</p>
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
          <ChevronLeft size={16} aria-hidden="true" />
          上一页
        </button>
        <button
          disabled={data.page >= data.totalPages}
          onClick={() => onPage(data.page + 1)}
        >
          下一页
          <ChevronRight size={16} aria-hidden="true" />
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
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = dialog.current;
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ) || [],
      );
    (
      panel?.querySelector<HTMLElement>("input, select, textarea") ||
      focusable()[0] ||
      panel
    )?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      }
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0],
          last = elements.at(-1);
        if (!elements.length) {
          event.preventDefault();
          panel?.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first ||
            !panel?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !panel?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="overlay" onClick={onClose}>
      <section
        ref={dialog}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button aria-label="关闭" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
