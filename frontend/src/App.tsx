import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Activity,
  ArrowRight,
  Building2,
  ChartNoAxesCombined,
  ClipboardList,
  LogOut,
  Eye,
  EyeOff,
  Play,
  Scissors,
  ShieldCheck,
  Users,
} from "lucide-react";
import { login, logout, refreshSession, sessionStore, ApiError } from "./api";
import { ErrorMessage, Field } from "./ui";
import { Tasks } from "./Tasks";
import { Management } from "./Management";
import { Statistics } from "./Statistics";
export function Login({ initialError }: { initialError?: unknown } = {}) {
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <Activity />
          </span>
          <strong>
            片段标注<span>VIDEO ANNOTATION</span>
          </strong>
        </div>
        <div className="login-message">
          <div className="eyebrow">PRECISION IN EVERY FRAME</div>
          <h1>
            精准每一帧，
            <br />
            让价值清晰可见。
          </h1>
          <p>
            连接团队、视频与洞察。
            <br />
            让精准标注成为智能的起点。
          </p>
          <div className="login-preview" aria-hidden="true">
            <div className="preview-top">
              <span>
                <i /> 标注工作空间
              </span>
              <Scissors size={16} />
            </div>
            <div className="preview-frame">
              <Play size={32} fill="currentColor" />
              <span>每一个片段，都有意义</span>
            </div>
            <div className="preview-ruler">
              <span>00:00</span>
              <span>00:15</span>
              <span>00:30</span>
              <span>00:45</span>
            </div>
            <div className="preview-track">
              <i />
              <i />
              <i />
              <b />
            </div>
            <div className="preview-bottom">
              <span>
                <Scissors size={14} /> 精确到毫秒
              </span>
              <span>记录 · 标注 · 交付</span>
            </div>
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
              <span className="password-input">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder="输入密码"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </Field>
            <ErrorMessage error={error || initialError} />
            <button className="primary full" disabled={busy}>
              {busy ? "正在登录…" : "进入工作台"}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="login-note">账号由平台管理员创建。</p>
        </div>
        <footer>视频片段标注平台</footer>
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
      <a className="skip-link" href="#main-content">
        跳转到主要内容
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Activity />
          </span>
          <strong>
            片段标注<span>VIDEO ANNOTATION</span>
          </strong>
        </div>
        <div className="workspace-label">
          {admin ? "平台管理空间" : "标注工作空间"}
        </div>
        <nav aria-label="主导航">
          {navigation.map((item) => (
            <button
              className={nav === item.id ? "active" : ""}
              aria-current={nav === item.id ? "page" : undefined}
              key={item.id}
              onClick={() => setNav(item.id)}
            >
              <item.icon size={19} aria-hidden="true" />
              {item.label}
              {nav === item.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-guide">
            <Scissors size={19} aria-hidden="true" />
            <strong>让专注，回到内容</strong>
            <p>
              选取片段，记录细节。
              <br />
              每一次标注都更进一步。
            </p>
          </div>
          <div className="system-status">
            <i />
            工作空间已连接
          </div>
          <p>VIDEO ANNOTATION PLATFORM</p>
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
              title="退出登录"
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
        <main className="content" id="main-content" tabIndex={-1}>
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
            <span>精准视频片段标注</span>
            <span>所有绝对时间按 Asia/Shanghai 展示</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
