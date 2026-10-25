import { useState } from "react";
import { Clock3, CalendarDays, Layers3 } from "lucide-react";
import { query } from "./api";
import { useOptions, useResource } from "./hooks";
import type { Statistics as StatisticsData, Page, Tenant, User } from "./types";
import { duration, Empty, ErrorMessage, Field, Pagination, today } from "./ui";
export function Statistics() {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState({
    fromDate: today(),
    toDate: today(),
    tenantId: "",
    annotatorId: "",
  });
  const data = useResource<StatisticsData>(
    `/statistics/daily${query({ ...filters, page })}`,
    revision,
  );
  const tenants = useOptions<Tenant>("/tenants");
  const users = useOptions<User>("/users?role=Annotator");
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">INSIGHTS & OUTPUT</div>
          <h1>每日工作量</h1>
          <p>让每一毫秒的有效贡献清晰可见。</p>
        </div>
        <span className="timezone">
          <CalendarDays size={16} />
          Asia/Shanghai
        </span>
      </div>
      <div className="filters stats-filters">
        <Field label="开始日期">
          <input
            aria-label="开始日期"
            type="date"
            required
            value={filters.fromDate}
            max={filters.toDate}
            onChange={(e) => {
              if (e.target.value) {
                setFilters({ ...filters, fromDate: e.target.value });
                setPage(1);
              }
            }}
          />
        </Field>
        <Field label="结束日期">
          <input
            aria-label="结束日期"
            type="date"
            required
            value={filters.toDate}
            min={filters.fromDate}
            onChange={(e) => {
              if (e.target.value) {
                setFilters({ ...filters, toDate: e.target.value });
                setPage(1);
              }
            }}
          />
        </Field>
        <Field label="租户">
          <select
            aria-label="租户"
            value={filters.tenantId}
            onChange={(e) => {
              setFilters({
                ...filters,
                tenantId: e.target.value,
                annotatorId: "",
              });
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
        </Field>
        <Field label="标注员">
          <select
            aria-label="标注员"
            value={filters.annotatorId}
            onChange={(e) => {
              setFilters({ ...filters, annotatorId: e.target.value });
              setPage(1);
            }}
          >
            <option value="">全部标注员</option>
            {users.data?.items
              .filter(
                (u) => !filters.tenantId || u.tenantId === filters.tenantId,
              )
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <ErrorMessage error={data.error || tenants.error || users.error} />
      {!!data.error && (
        <div className="inline-actions">
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            重试查询
          </button>
        </div>
      )}
      <div className="metrics">
        <article className="metric dark">
          <div>
            <Clock3 size={19} />
            <span>有效标注总时长</span>
          </div>
          <strong>
            {data.data ? duration(data.data.totalDurationMs) : "—"}
          </strong>
          <small>当前已提交任务 · 毫秒精度</small>
        </article>
        <article className="metric">
          <div>
            <Layers3 size={19} />
            <span>有效提交</span>
          </div>
          <strong>
            {data.data?.totalItems ?? "—"}
            <small> 个任务</small>
          </strong>
          <small>退回后即时移出，重新提交重新计入</small>
        </article>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h3>每日明细</h3>
          <span>日期 → 租户 → 标注员 → 任务 → 片段</span>
        </div>
        <p className="hint padded">
          总量按完整筛选结果计算；展开的任务与片段按页显示。
        </p>
        {data.loading ? (
          <p className="loading">正在汇总…</p>
        ) : data.error ? (
          <Empty
            text="统计暂时无法加载"
            hint="请检查网络或调整筛选条件后重试。"
          />
        ) : !data.data?.days.length ? (
          <Empty text="所选日期暂无有效提交" />
        ) : (
          <div className="stats-tree">
            {data.data.days.map((day) => (
              <details key={day.date} open>
                <summary>
                  <strong>{day.date}</strong>
                  <span>{duration(day.durationMs)}</span>
                </summary>
                {day.tenants.map((tenant) => (
                  <details className="tree-indent" key={tenant.tenantId}>
                    <summary>
                      {tenant.tenantName}
                      <span>{duration(tenant.durationMs)}</span>
                    </summary>
                    {tenant.annotators.map((user) => (
                      <details className="tree-indent" key={user.annotatorId}>
                        <summary>
                          {user.username}
                          <span>{duration(user.durationMs)}</span>
                        </summary>
                        {user.tasks.map((task) => (
                          <details className="tree-indent" key={task.id}>
                            <summary>
                              {task.name}
                              <span>
                                {duration(
                                  task.durationMs ||
                                    task.segments.reduce(
                                      (n, s) => n + s.durationMs,
                                      0,
                                    ),
                                )}
                              </span>
                            </summary>
                            <div className="tree-segments">
                              {task.segments.map((s, i) => (
                                <div key={s.id}>
                                  <span>
                                    片段 {i + 1} · {duration(s.startMs)} —{" "}
                                    {duration(s.endMs)}
                                  </span>
                                  <strong>{duration(s.durationMs)}</strong>
                                </div>
                              ))}
                            </div>
                          </details>
                        ))}
                      </details>
                    ))}
                  </details>
                ))}
              </details>
            ))}
          </div>
        )}
        {data.data && <Pagination data={data.data} onPage={setPage} />}
      </section>
    </>
  );
}
