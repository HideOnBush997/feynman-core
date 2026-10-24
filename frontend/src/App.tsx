import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Activity,
  ArrowRight,
  Building2,
  ChartNoAxesCombined,
  ClipboardList,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  changePassword,
  login,
  logout,
  refreshSession,
  sessionStore,
  ApiError,
} from "./api";
import { ErrorMessage, Field } from "./ui";
import { Tasks } from "./Tasks";
import { Management } from "./Management";
import { Statistics } from "./Statistics";
export function Login({ initialError }: { initialError?: unknown } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <Activity />
          </span>
          <strong>
            费曼智核<span>FEYNMAN CORE</span>
          </strong>
        </div>
        <div className="login-message">
          <div className="eyebrow">PRECISION IN EVERY FRAME</div>
          <h1>
            从每一帧，
            <br />
            发现有价值的未来。
          </h1>
          <p>
            连接团队、视频与洞察。
            <br />
            让精准标注成为智能的起点。
          </p>
          <div className="waveform">
            {Array.from({ length: 40 }, (_, i) => (
              <i
                key={i}
                style={{ height: `${20 + Math.sin(i * 0.8) ** 2 * 70}%` }}
              />
            ))}
          </div>
          <span className="story-caption">VIDEO ANNOTATION PLATFORM · 01</span>
        </div>
        <footer>专注每一毫秒的价值</footer>
      </section>
      <section className="login-form">
        <div>
          <span className="pill">
            <ShieldCheck size={14} />
            安全工作空间
          </span>
          <h2>欢迎回来</h2>
          <p className="muted">登录以继续你的标注工作。</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(undefined);
              const fd = new FormData(e.currentTarget);
              try {
                await login(
                  String(fd.get("username")),
                  String(fd.get("password")),
                );
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="用户名">
              <input
                name="username"
                autoComplete="username"
                required
                maxLength={50}
                placeholder="输入你的用户名"
              />
            </Field>
            <Field label="密码">
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="输入密码"
              />
            </Field>
            <ErrorMessage error={error || initialError} />
            <button className="primary full" disabled={busy}>
              {busy ? "正在登录…" : "进入工作台"}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="login-note">
            账号由平台管理员创建。首次登录需修改临时密码。
          </p>
        </div>
        <footer>费曼智核 · 视频片段标注平台</footer>
      </section>
    </main>
  );
}
export function PasswordChange({
  onLogoutError,
}: { onLogoutError?: (error: unknown) => void } = {}) {
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  return (
    <main className="password-page">
      <section className="panel password-panel">
        <ShieldCheck size={32} />
        <h1>设置你的新密码</h1>
        <p className="muted">首次登录请修改管理员设置的临时密码。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            if (fd.get("newPassword") !== fd.get("confirm")) {
              setError(new Error("两次输入的新密码不一致"));
              return;
            }
            setBusy(true);
            setError(undefined);
            try {
              await changePassword(
                String(fd.get("currentPassword")),
                String(fd.get("newPassword")),
              );
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="当前临时密码">
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="新密码">
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
            />
          </Field>
          <Field label="确认新密码">
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
            />
          </Field>
          <p className="hint">至少 6 位，包含大写、小写、数字和符号。</p>
          <ErrorMessage error={error} />
          <button className="primary full" disabled={busy}>
            {busy ? "正在更新…" : "更新密码并继续"}
          </button>
          <button
            className="full"
            type="button"
            onClick={() => {
              logout().catch((e) => {
                setError(e);
                onLogoutError?.(e);
              });
            }}
          >
            退出登录
          </button>
        </form>
      </section>
    </main>
  );
}
export default function App() {
  const session = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.get,
  );
  const [restoring, setRestoring] = useState(true);
  const [nav, setNav] = useState("tasks");
  const [logoutError, setLogoutError] = useState<unknown>();
  const [restoreError, setRestoreError] = useState<unknown>();
  useEffect(() => {
    refreshSession()
      .catch((error: unknown) => {
        if (!(
          error instanceof ApiError &&
          error.problem.status === 401 &&
          error.problem.code === "refresh_token_invalid"
        ))
          setRestoreError(error);
      })
      .finally(() => setRestoring(false));
  }, []);
  useEffect(() => {
    setNav("tasks");
  }, [session?.user.id]);
  if (restoring)
    return (
      <div className="startup">
        <Activity size={32} />
        <p>正在恢复安全会话…</p>
      </div>
    );
  if (!session) return <Login initialError={logoutError || restoreError} />;
  if (session.user.mustChangePassword)
    return <PasswordChange onLogoutError={setLogoutError} />;
  const admin = session.user.role === "PlatformAdmin";
  const navigation = [
    {
      id: "tasks",
      label: admin ? "任务管理" : "标注工作台",
      icon: ClipboardList,
    },
    ...(admin
      ? [
          { id: "statistics", label: "工作量统计", icon: ChartNoAxesCombined },
          { id: "tenants", label: "租户管理", icon: Building2 },
          { id: "users", label: "账号管理", icon: Users },
        ]
      : []),
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Activity />
          </span>
          <strong>
            费曼智核<span>FEYNMAN CORE</span>
          </strong>
        </div>
        <div className="workspace-label">
          {admin ? "平台管理空间" : "标注工作空间"}
        </div>
        <nav>
          {navigation.map((item) => (
            <button
              className={nav === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setNav(item.id)}
            >
              <item.icon size={19} />
              {item.label}
              {nav === item.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="system-status">
            <i />
            工作空间已连接
          </div>
          <p>精准，始于每一个片段。</p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            工作空间 <span className="slash">/</span>{" "}
            {navigation.find((n) => n.id === nav)?.label}
          </span>
          <div className="account">
            <span className="avatar">
              {session.user.username.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{session.user.username}</strong>
              <small>{admin ? "平台管理员" : "标注员"}</small>
            </div>
            <button
              aria-label="退出登录"
              onClick={async () => {
                try {
                  await logout();
                } catch (e) {
                  setLogoutError(e);
                }
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="content">
          <ErrorMessage error={logoutError} />
          {nav === "tasks" ? (
            <Tasks user={session.user} />
          ) : nav === "statistics" && admin ? (
            <Statistics />
          ) : admin ? (
            <Management
              key={nav}
              kind={nav === "tenants" ? "tenants" : "users"}
            />
          ) : null}
          <footer className="page-footer">
            <span>费曼智核 · 精准视频标注</span>
            <span>所有绝对时间按 Asia/Shanghai 展示</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
