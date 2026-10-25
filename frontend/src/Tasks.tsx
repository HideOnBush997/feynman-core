import { useState } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Film,
  Building2,
  Clock3,
  ChevronDown,
} from "lucide-react";
import { api, query } from "./api";
import { useOptions, useResource } from "./hooks";
import type { Page, Task, Tenant, User, TaskStatus } from "./types";
import {
  Badge,
  Empty,
  ErrorMessage,
  Field,
  Modal,
  Pagination,
  shanghai,
  statuses,
} from "./ui";
import { Annotation } from "./Annotation";
export function TaskForm({
  task,
  tenants,
  onSaved,
}: {
  task?: Task;
  tenants: Tenant[];
  onSaved: () => void;
}) {
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  function localDate(value: string | null) {
    if (!value) return "";
    return new Date(new Date(value).getTime() + 8 * 3600000)
      .toISOString()
      .slice(0, 19);
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError(undefined);
        try {
          const body = {
            name: String(form.get("name")).trim(),
            tenantId: form.get("tenantId"),
            videoUrl: form.get("videoUrl"),
            instructions: form.get("instructions"),
            dueAtLocal: form.get("dueAtLocal")
              ? String(form.get("dueAtLocal")).length === 16
                ? `${form.get("dueAtLocal")}:00`
                : String(form.get("dueAtLocal")).slice(0, 19)
              : null,
            expectedVersion: task?.version,
          };
          if (task) await api.patch(`/tasks/${task.id}`, body);
          else await api.post("/tasks", body);
          onSaved();
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ErrorMessage error={error} />
      <Field label="任务名称">
        <input name="name" required maxLength={200} defaultValue={task?.name} />
      </Field>
      <Field label="所属租户">
        <select name="tenantId" required defaultValue={task?.tenantId || ""}>
          <option value="">选择启用租户</option>
          {tenants
            .filter((t) => t.isActive)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="公开视频直链">
        <input
          name="videoUrl"
          type="url"
          pattern="https?://.*"
          required
          maxLength={2048}
          defaultValue={task?.videoUrl}
          placeholder="https://…/video.mp4"
        />
      </Field>
      <Field label="标注说明">
        <textarea
          name="instructions"
          maxLength={4000}
          rows={4}
          defaultValue={task?.instructions || ""}
        />
      </Field>
      <Field label="截止时间（Asia/Shanghai，可选）">
        <input
          type="datetime-local"
          name="dueAtLocal"
          step="1"
          defaultValue={localDate(task?.dueAtUtc || null)}
        />
      </Field>
      <p className="hint">先保存为草稿，确认后单独发布。发布后基本信息锁定。</p>
      <button className="primary full" disabled={busy}>
        {busy ? "保存中…" : "保存草稿"}
      </button>
    </form>
  );
}
export function Tasks({ user }: { user: User }) {
  const admin = user.role === "PlatformAdmin";
  const [tab, setTab] = useState("available");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState({
    name: "",
    status: "",
    tenantId: "",
    overdue: "",
    sort: "createdAtUtc",
  });
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [selected, setSelected] = useState<Task>();
  const [formTask, setFormTask] = useState<Task | null | undefined>();
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState<{ task: Task; action: string }>();
  const tenants = useOptions<Tenant>(admin ? "/tenants" : null, revision);
  const users = useOptions<User>(
    admin ? "/users?role=Annotator" : null,
    revision,
  );
  const path = `/tasks${admin ? "" : `/${tab}`}${query({ ...filters, status: admin || tab === "mine" ? filters.status : undefined, page, dueFromUtc: dueFrom ? new Date(`${dueFrom}+08:00`).toISOString() : undefined, dueToUtc: dueTo ? new Date(`${dueTo}+08:00`).toISOString() : undefined })}`;
  const list = useResource<Page<Task>>(path, revision);
  const filtered = !!(
    filters.name ||
    ((admin || tab === "mine") && filters.status) ||
    filters.tenantId ||
    filters.overdue ||
    dueFrom ||
    dueTo ||
    filters.sort !== "createdAtUtc"
  );
  const reload = () => setRevision((r) => r + 1);
  async function detail(task: Task) {
    setError(undefined);
    try {
      setSelected(await api.get<Task>(`/tasks/${task.id}`));
    } catch (e) {
      setError(e);
    }
  }
  async function act(
    task: Task,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    setBusy(true);
    setError(undefined);
    try {
      const next = await api.post<Task>(`/tasks/${task.id}/${action}`, {
        expectedVersion: task.version,
        ...extra,
      });
      setMessage("操作已完成");
      setCommand(undefined);
      if (selected?.id === task.id) setSelected(next);
      reload();
    } catch (e) {
      setError(e);
      reload();
      if (selected?.id === task.id)
        try {
          setSelected(await api.get<Task>(`/tasks/${task.id}`));
        } catch {
          /* Preserve mutation error. */
        }
    } finally {
      setBusy(false);
    }
  }
  const actions = (task: Task) =>
    admin ? (
      <>
        {task.status === "Draft" && (
          <>
            <button onClick={() => setFormTask(task)}>编辑草稿</button>
            <button onClick={() => setCommand({ task, action: "publish" })}>
              发布
            </button>
          </>
        )}
        {["Claimed", "Correction"].includes(task.status) && (
          <button onClick={() => setCommand({ task, action: "recall" })}>
            收回
          </button>
        )}
        {["Draft", "Available", "Claimed"].includes(task.status) && (
          <button
            className="danger-text"
            onClick={() => setCommand({ task, action: "cancel" })}
          >
            取消任务
          </button>
        )}
        {task.status === "Submitted" && (
          <button onClick={() => setCommand({ task, action: "reject" })}>
            退回修正
          </button>
        )}
        {task.status === "Correction" && (
          <button onClick={() => setCommand({ task, action: "reassign" })}>
            改派
          </button>
        )}
      </>
    ) : (
      <>
        {task.status === "Available" && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => act(task, "claim")}
          >
            领取任务
          </button>
        )}
        {task.status === "Claimed" && task.assigneeUserId === user.id && (
          <button onClick={() => setCommand({ task, action: "return" })}>
            退回任务
          </button>
        )}
      </>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {admin ? "TASK MANAGEMENT" : "YOUR WORKSPACE"}
          </div>
          <h1>{admin ? "任务管理" : "标注工作台"}</h1>
          <p>
            {admin
              ? "从任务发布到结果交付，管理每一步。"
              : "专注每一个有价值的片段。"}
          </p>
        </div>
        {admin && (
          <button className="primary" onClick={() => setFormTask(null)}>
            <Plus size={17} />
            创建任务
          </button>
        )}
      </div>
      {!admin && (
        <div className="tabs">
          <button
            className={tab === "available" ? "active" : ""}
            onClick={() => {
              setTab("available");
              setPage(1);
            }}
          >
            可领取任务
          </button>
          <button
            className={tab === "mine" ? "active" : ""}
            onClick={() => {
              setTab("mine");
              setPage(1);
            }}
          >
            我的任务
          </button>
        </div>
      )}
      <ErrorMessage
        error={error || list.error || tenants.error || users.error}
      />
      {message && (
        <p role="status" className="notice success">
          {message}
        </p>
      )}
      <div className="filter-panel">
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            reload();
          }}
        >
          <label className="search-input">
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="搜索任务"
              placeholder="搜索任务名称…"
              value={filters.name}
              onChange={(e) => {
                setFilters({ ...filters, name: e.target.value });
                setPage(1);
              }}
            />
          </label>
          {(admin || tab === "mine") && (
            <select
              aria-label="任务状态"
              value={filters.status}
              onChange={(e) => {
                setFilters({ ...filters, status: e.target.value });
                setPage(1);
              }}
            >
              <option value="">全部状态</option>
              {Object.entries(statuses)
                .filter(
                  ([k]) =>
                    admin || ["Claimed", "Correction", "Submitted"].includes(k),
                )
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </select>
          )}
          {admin && (
            <select
              aria-label="筛选租户"
              value={filters.tenantId}
              onChange={(e) => {
                setFilters({ ...filters, tenantId: e.target.value });
                setPage(1);
              }}
            >
              <option value="">全部租户</option>
              {tenants.data?.items.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="逾期筛选"
            value={filters.overdue}
            onChange={(e) => {
              setFilters({ ...filters, overdue: e.target.value });
              setPage(1);
            }}
          >
            <option value="">全部截止状态</option>
            <option value="true">已逾期</option>
            <option value="false">未逾期</option>
          </select>
          <select
            aria-label="任务排序"
            value={filters.sort}
            onChange={(e) => {
              setFilters({ ...filters, sort: e.target.value });
              setPage(1);
            }}
          >
            <option value="createdAtUtc">最新创建</option>
            <option value="dueAtUtc">截止时间优先</option>
            <option value="name">任务名称</option>
          </select>
          <button type="submit" aria-label="刷新任务" title="刷新任务">
            <RefreshCw size={16} />
          </button>
        </form>
        <div className="filter-secondary">
          {admin && (
            <details className="advanced-filters">
              <summary>
                <SlidersHorizontal size={15} aria-hidden="true" />
                截止时间筛选
                {(dueFrom || dueTo) && (
                  <span className="filter-indicator">已设置</span>
                )}
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <div className="date-filters">
                <Field label="截止时间起（北京时间）">
                  <input
                    type="datetime-local"
                    value={dueFrom}
                    onChange={(e) => {
                      setDueFrom(e.target.value);
                      setPage(1);
                    }}
                  />
                </Field>
                <Field label="截止时间止（不含，北京时间）">
                  <input
                    type="datetime-local"
                    value={dueTo}
                    onChange={(e) => {
                      setDueTo(e.target.value);
                      setPage(1);
                    }}
                  />
                </Field>
              </div>
            </details>
          )}
          {filtered && (
            <button
              className="reset-filters"
              onClick={() => {
                setFilters({
                  name: "",
                  status: "",
                  tenantId: "",
                  overdue: "",
                  sort: "createdAtUtc",
                });
                setDueFrom("");
                setDueTo("");
                setPage(1);
              }}
            >
              清除筛选
            </button>
          )}
        </div>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h3>
            <Film size={18} aria-hidden="true" />
            {admin
              ? "全部任务"
              : tab === "available"
                ? "等待你的下一次发现"
                : "我的标注任务"}
          </h3>
          <div className="list-tools">
            <span className="result-count">
              {list.data ? `${list.data.totalItems} 个任务` : "加载中"}
            </span>
            <div className="view-toggle" role="group" aria-label="任务视图">
              <button
                aria-label="卡片视图"
                title="卡片视图"
                aria-pressed={view === "grid"}
                onClick={() => setView("grid")}
              >
                <LayoutGrid size={17} />
              </button>
              <button
                aria-label="列表视图"
                title="列表视图"
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
              >
                <List size={18} />
              </button>
            </div>
          </div>
        </div>
        {list.loading ? (
          <p className="loading" role="status">
            正在加载任务…
          </p>
        ) : !list.data?.items.length ? (
          <Empty
            hint={
              filtered
                ? "调整或清除筛选条件，找到你需要的任务。"
                : admin
                  ? "点击「创建任务」，开始安排团队的标注工作。"
                  : "暂时没有任务，稍后再来看看。"
            }
          />
        ) : (
          <div className={`task-grid ${view === "list" ? "list-view" : ""}`}>
            {list.data.items.map((task) => (
              <article className="task-card" key={task.id}>
                <div className="card-top">
                  <span className="task-type">
                    <Film size={20} aria-hidden="true" />
                  </span>
                  <Badge status={task.status} />
                  {task.isOverdue && <span className="overdue">逾期</span>}
                </div>
                <button className="task-title" onClick={() => detail(task)}>
                  {task.name}
                  <ArrowUpRight size={17} />
                </button>
                <p className="task-instructions">
                  {task.instructions || "暂无标注说明"}
                </p>
                <div className="task-meta">
                  <span>
                    <Building2 size={14} aria-hidden="true" />
                    {task.tenantName ||
                      tenants.data?.items.find((t) => t.id === task.tenantId)
                        ?.name ||
                      "所属租户任务"}
                  </span>
                  <span>
                    <Clock3 size={14} aria-hidden="true" />
                    {shanghai(task.dueAtUtc)}
                  </span>
                </div>
                <div className="card-actions">
                  <button className="open-task" onClick={() => detail(task)}>
                    打开任务
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                  {actions(task)}
                </div>
              </article>
            ))}
          </div>
        )}
        {list.data && <Pagination data={list.data} onPage={setPage} />}
      </section>
      {formTask !== undefined && (
        <Modal
          title={formTask ? "编辑草稿" : "创建任务草稿"}
          onClose={() => setFormTask(undefined)}
        >
          <TaskForm
            task={formTask || undefined}
            tenants={tenants.data?.items || []}
            onSaved={() => {
              setFormTask(undefined);
              setMessage("草稿已保存");
              reload();
            }}
          />
        </Modal>
      )}
      {selected && (
        <div className="detail-overlay">
          <section className="detail-sheet">
            <div className="detail-toolbar">
              <button onClick={() => setSelected(undefined)}>
                <ArrowLeft size={17} aria-hidden="true" /> 返回任务列表
              </button>
              <div className="inline-actions">{actions(selected)}</div>
            </div>
            <Annotation
              key={selected.id}
              initialTask={selected}
              user={user}
              onChanged={(next) => {
                setSelected(next);
                reload();
              }}
            />
            {admin && (
              <p className="hint">
                当前负责人：
                {selected.assigneeUsername ||
                  users.data?.items.find(
                    (u) => u.id === selected.assigneeUserId,
                  )?.username ||
                  selected.assigneeUserId ||
                  "未分配"}{" "}
                · 最近提交人：
                {users.data?.items.find(
                  (u) => u.id === selected.latestSubmitterUserId,
                )?.username ||
                  selected.latestSubmitterUserId ||
                  "尚未提交"}
              </p>
            )}
          </section>
        </div>
      )}
      {command && (
        <Modal
          title={
            (
              {
                publish: "发布任务",
                recall: "收回任务",
                cancel: "取消任务",
                reject: "退回修正",
                reassign: "改派负责人",
                return: "退回任务",
              } as Record<string, string>
            )[command.action]
          }
          onClose={() => setCommand(undefined)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void act(
                command.task,
                command.action,
                command.action === "reject"
                  ? { reason: fd.get("reason") }
                  : command.action === "reassign"
                    ? { assigneeUserId: fd.get("assigneeUserId") }
                    : {},
              );
            }}
          >
            <p>任务：{command.task.name}</p>
            <p className="hint">
              {command.action === "cancel"
                ? "取消后进入终态，已领取任务将解除分配。"
                : command.action === "reject"
                  ? "原片段保留，立即退出统计，等待修正重新提交。"
                  : command.action === "publish"
                    ? "发布后基本信息将锁定。"
                    : "原片段将保留。"}
            </p>
            {command.action === "reject" && (
              <Field label="退回说明">
                <textarea name="reason" rows={3} />
              </Field>
            )}
            {command.action === "reassign" && (
              <Field label="新的标注员">
                <select required name="assigneeUserId">
                  <option value="">选择同租户启用标注员</option>
                  {users.data?.items
                    ?.filter(
                      (u) => u.isActive && u.tenantId === command.task.tenantId,
                    )
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <ErrorMessage error={error} />
            <button className="primary full" disabled={busy}>
              {busy ? "处理中…" : "确认操作"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
