import type { Session, Problem } from "./types";
export class ApiError extends Error {
  constructor(public problem: Problem) {
    super(problem.detail || problem.title);
    this.name = "ApiError";
  }
}
let session: Session | null = null;
let sessionRevision = 0;
let refreshPromise: Promise<Session> | null = null;
const listeners = new Set<() => void>();
export const sessionStore = {
  get: () => session,
  set: (value: Session | null) => {
    session = value;
    sessionRevision++;
    listeners.forEach((fn) => fn());
  },
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
const base = import.meta.env.VITE_API_BASE_URL || "/api/v1";
function csrf() {
  return document.cookie
    .split("; ")
    .find((s) => s.startsWith("feynman_csrf="))
    ?.split("=")
    .slice(1)
    .join("=");
}
async function send<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (session) headers.set("Authorization", `Bearer ${session.accessToken}`);
  if (path === "/auth/refresh" || path === "/auth/logout") {
    const token = csrf();
    if (token) headers.set("X-CSRF-Token", decodeURIComponent(token));
  }
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiError({
      title: "网络连接失败",
      detail: "无法连接服务，请检查网络后重试。",
      status: 0,
      code: "network_error",
    });
  }
  if (!response.ok) {
    let problem: Problem;
    try {
      problem = await response.json();
    } catch {
      problem = {
        title: "服务响应异常",
        status: response.status,
        code: "unexpected_response",
      };
    }
    throw new ApiError({ ...problem, status: response.status });
  }
  if (response.status === 204) return undefined as T;
  try {
    return await response.json();
  } catch {
    throw new ApiError({
      title: "服务响应格式异常",
      status: response.status,
      code: "unexpected_response",
    });
  }
}
export function refreshSession(): Promise<Session> {
  if (!refreshPromise) {
    const startedAt = sessionRevision;
    refreshPromise = send<Session>("/auth/refresh", { method: "POST" })
      .then((value) => {
        if (sessionRevision !== startedAt)
          throw new ApiError({
            title: "会话已变化，请重新登录",
            status: 401,
            code: "session_changed",
          });
        sessionStore.set(value);
        return value;
      })
      .catch((error) => {
        if (sessionRevision === startedAt) sessionStore.set(null);
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const sentToken = session?.accessToken;
  try {
    return await send<T>(path, options);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.problem.status === 401 &&
      !path.startsWith("/auth/")
    ) {
      if (!session || session.accessToken === sentToken) await refreshSession();
      try {
        return await send<T>(path, options);
      } catch (retryError) {
        if (
          retryError instanceof ApiError &&
          [401, 403].includes(retryError.problem.status)
        )
          sessionStore.set(null);
        throw retryError;
      }
    }
    if (
      error instanceof ApiError &&
      error.problem.status === 403 &&
      ["account_disabled", "tenant_disabled"].includes(error.problem.code)
    )
      sessionStore.set(null);
    throw error;
  }
}
export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown = {}) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string, version: number) =>
    request<T>(path, {
      method: "DELETE",
      headers: { "If-Match": String(version) },
      body: JSON.stringify({ expectedVersion: version }),
    }),
};
export async function login(username: string, password: string) {
  const value = await api.post<Session>("/auth/login", { username, password });
  sessionStore.set(value);
  return value;
}
export async function logout() {
  try {
    await api.post("/auth/logout");
  } finally {
    sessionStore.set(null);
  }
}
export async function changePassword(
  currentPassword: string,
  newPassword: string,
) {
  const value = await api.post<Session>("/auth/change-password", {
    currentPassword,
    newPassword,
  });
  sessionStore.set(value);
  return value;
}
export function query(
  values: Record<string, string | number | boolean | null | undefined>,
) {
  const params = new URLSearchParams();
  Object.entries({ page: 1, pageSize: 20, ...values } as Record<
    string,
    string | number | boolean | null | undefined
  >).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  });
  return `?${params}`;
}
