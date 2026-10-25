import { useState } from "react";
import { Plus, Users, Building2, Search } from "lucide-react";
import { api, query } from "./api";
import { useOptions, useResource } from "./hooks";
import type { Page, Tenant, User } from "./types";
import { Empty, ErrorMessage, Field, Modal, Pagination } from "./ui";
export function Management({ kind }: { kind: "tenants" | "users" }) {
  const tenantMode = kind === "tenants";
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  const [role, setRole] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [creating, setCreating] = useState(false);
  const [userRole, setUserRole] = useState("Annotator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<Tenant>();
  const [deactivating, setDeactivating] = useState<Tenant | User>();
  const list = useResource<Page<Tenant & User>>(
    `/${kind}${query({ page, [tenantMode ? "name" : "username"]: search, isActive: active, role: tenantMode ? "" : role, tenantId: tenantMode ? "" : tenantId })}`,
    revision,
  );
  const tenants = useOptions<Tenant>(!tenantMode ? "/tenants" : null, revision);
  async function create(form: HTMLFormElement) {
    setBusy(true);
    setError(undefined);
    const fd = new FormData(form);
    try {
      await api.post(
        `/${kind}`,
        tenantMode
          ? { name: fd.get("name") }
          : {
              username: fd.get("username"),
              role: userRole,
              tenantId: userRole === "Annotator" ? fd.get("tenantId") : null,
              temporaryPassword: fd.get("temporaryPassword"),
            },
      );
      setCreating(false);
      setMessage(tenantMode ? "租户已创建" : "账号已创建");
      setRevision((r) => r + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function deactivate() {
    if (!deactivating) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/${kind}/${deactivating.id}/deactivate`);
      setDeactivating(undefined);
      setRevision((r) => r + 1);
      setMessage("已停用，历史记录保留");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ORGANIZATION</div>
          <h1>{tenantMode ? "租户管理" : "账号管理"}</h1>
          <p>
            {tenantMode
              ? "独立的团队空间，清晰的数据边界。"
              : "为每个团队配置合适的工作角色。"}
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setCreating(true);
            setError(undefined);
          }}
        >
          <Plus size={17} />
          {tenantMode ? "创建租户" : "创建账号"}
        </button>
      </div>
      <ErrorMessage error={list.error || error || tenants.error} />
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      <div className="filters management-filters">
        <label className="search-input">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label={tenantMode ? "搜索租户" : "搜索账号"}
            placeholder={tenantMode ? "搜索租户名称…" : "搜索用户名…"}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <select
          aria-label="启停状态"
          value={active}
          onChange={(e) => {
            setActive(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部启停状态</option>
          <option value="true">启用</option>
          <option value="false">停用</option>
        </select>
        {!tenantMode && (
          <>
            <select
              aria-label="角色筛选"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部角色</option>
              <option value="PlatformAdmin">平台管理员</option>
              <option value="Annotator">标注员</option>
            </select>
            <select
              aria-label="账号租户筛选"
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
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
          </>
        )}
      </div>
      <section className="panel">
        <div className="panel-title">
          <h3>
            {tenantMode ? <Building2 size={18} /> : <Users size={18} />}{" "}
            {tenantMode ? "团队租户" : "平台账号"}
          </h3>
          <span>{list.data?.totalItems || 0} 条记录</span>
        </div>
        {list.loading ? (
          <p className="loading">正在加载…</p>
        ) : !list.data?.items.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tenantMode ? "租户名称" : "用户名"}</th>
                  {!tenantMode && (
                    <>
                      <th>角色</th>
                      <th>所属租户</th>
                    </>
                  )}
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{tenantMode ? item.name : item.username}</strong>
                    </td>
                    {!tenantMode && (
                      <>
                        <td>
                          {item.role === "PlatformAdmin"
                            ? "平台管理员"
                            : "标注员"}
                        </td>
                        <td>
                          {item.tenantName ||
                            tenants.data?.items.find(
                              (t) => t.id === item.tenantId,
                            )?.name ||
                            "—"}
                        </td>
                      </>
                    )}
                    <td>
                      <span
                        className={`badge ${item.isActive ? "available" : "cancelled"}`}
                      >
                        {item.isActive ? "启用" : "停用"}
                      </span>
                    </td>
                    <td>
                      <div className="inline-actions">
                        {tenantMode && (
                          <button
                            onClick={async () => {
                              try {
                                setDetail(
                                  await api.get<Tenant>(`/tenants/${item.id}`),
                                );
                              } catch (e) {
                                setError(e);
                              }
                            }}
                          >
                            详情
                          </button>
                        )}
                        <button
                          className="danger-text"
                          disabled={!item.isActive}
                          onClick={() => setDeactivating(item)}
                        >
                          停用
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination data={list.data} onPage={setPage} />}
      </section>
      {creating && (
        <Modal
          title={tenantMode ? "创建租户" : "创建账号"}
          onClose={() => setCreating(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create(e.currentTarget);
            }}
          >
            <ErrorMessage error={error} />
            {tenantMode ? (
              <Field label="租户名称">
                <input name="name" required maxLength={200} />
              </Field>
            ) : (
              <>
                <Field label="用户名">
                  <input
                    name="username"
                    required
                    maxLength={50}
                    autoComplete="off"
                  />
                </Field>
                <Field label="账号角色">
                  <select
                    value={userRole}
                    onChange={(e) => setUserRole(e.target.value)}
                  >
                    <option value="Annotator">标注员</option>
                    <option value="PlatformAdmin">平台管理员</option>
                  </select>
                </Field>
                {userRole === "Annotator" && (
                  <Field label="所属租户">
                    <select name="tenantId" required>
                      <option value="">选择启用租户</option>
                      {tenants.data?.items
                        .filter((t) => t.isActive)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                <Field label="密码">
                  <input
                    name="temporaryPassword"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                </Field>
                <p className="hint">密码至少 6 位，可使用纯数字或字母。</p>
              </>
            )}
            <button className="primary full" disabled={busy}>
              {busy ? "创建中…" : "确认创建"}
            </button>
          </form>
        </Modal>
      )}
      {detail && (
        <Modal title="租户详情" onClose={() => setDetail(undefined)}>
          <h3>{detail.name}</h3>
          <p>状态：{detail.isActive ? "启用" : "停用"}</p>
          <p className="id">{detail.id}</p>
          <p className="hint">
            停用后禁止租户用户继续操作，历史任务与统计保留。
          </p>
        </Modal>
      )}
      {deactivating && (
        <Modal
          title={tenantMode ? "停用租户" : "停用账号"}
          onClose={() => setDeactivating(undefined)}
        >
          <p>
            确认停用「
            {"name" in deactivating ? deactivating.name : deactivating.username}
            」？
          </p>
          <p className="hint">停用立即影响登录和后续请求，历史数据保留。</p>
          <ErrorMessage error={error} />
          <button
            className="danger full"
            disabled={busy}
            onClick={() => void deactivate()}
          >
            确认停用
          </button>
        </Modal>
      )}
    </>
  );
}
