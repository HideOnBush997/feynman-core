import { vi, expect, it, describe, beforeEach } from "vitest";
import {
  api,
  ApiError,
  changePassword,
  login,
  logout,
  query,
  refreshSession,
  sessionStore,
} from "./api";
import type { Session } from "./types";
const session: Session = {
  accessToken: "old-token",
  expiresAtUtc: "2030-01-01T00:00:00Z",
  user: {
    id: "u",
    username: "测试",
    role: "Annotator",
    tenantId: "t",
    isActive: true,
    mustChangePassword: false,
  },
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  document.cookie = "feynman_csrf=csrf-value";
});
describe("API client and session", () => {
  it("encodes paging and omits empty filters", () => {
    expect(query({ page: 2, name: "视频 一", tenantId: "" })).toBe(
      "?page=2&pageSize=20&name=%E8%A7%86%E9%A2%91+%E4%B8%80",
    );
  });
  it("sends memory token, credentials, JSON, and DELETE version condition", async () => {
    sessionStore.set(session);
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await api.delete("/tasks/t/segments/s", 7);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/v1/tasks/t/segments/s");
    expect(options?.credentials).toBe("include");
    const headers = new Headers(options?.headers);
    expect(headers.get("Authorization")).toBe("Bearer old-token");
    expect(headers.get("If-Match")).toBe("7");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(options?.body as string)).toEqual({ expectedVersion: 7 });
  });
  it("preserves RFC Problem Details fields", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json(
        {
          title: "片段重叠",
          code: "segment_overlap",
          errors: { startMs: ["重叠"] },
          traceId: "trace",
        },
        409,
      ),
    );
    await expect(api.post("/tasks/t/segments", {})).rejects.toMatchObject({
      problem: {
        status: 409,
        code: "segment_overlap",
        errors: { startMs: ["重叠"] },
        traceId: "trace",
      },
    });
  });
  it("distinguishes network errors and malformed responses", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
    await expect(api.get("/tasks")).rejects.toMatchObject({
      problem: { code: "network_error", status: 0 },
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response("bad gateway", { status: 502 }),
    );
    await expect(api.get("/tasks")).rejects.toMatchObject({
      problem: { code: "unexpected_response", status: 502 },
    });
  });
  it("merges concurrent refreshes and sends double submit CSRF", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({ ...session, accessToken: "new-token" }),
    );
    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get(
        "X-CSRF-Token",
      ),
    ).toBe("csrf-value");
    expect(sessionStore.get()?.accessToken).toBe("new-token");
  });
  it("refreshes on 401 and retries with new token once", async () => {
    sessionStore.set(session);
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ code: "token_expired" }, 401))
      .mockResolvedValueOnce(json({ ...session, accessToken: "new-token" }))
      .mockResolvedValueOnce(json({ items: [] }));
    expect(await api.get("/tasks")).toEqual({ items: [] });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      new Headers(vi.mocked(fetch).mock.calls[2][1]?.headers).get(
        "Authorization",
      ),
    ).toBe("Bearer new-token");
  });
  it("does not loop after repeated 401 and clears session", async () => {
    sessionStore.set(session);
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ code: "token_expired" }, 401))
      .mockResolvedValueOnce(json(session))
      .mockResolvedValueOnce(json({ code: "token_expired" }, 401));
    await expect(api.get("/tasks")).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sessionStore.get()).toBeNull();
  });
  it("failed restore clears memory and login failure does not refresh", async () => {
    sessionStore.set(session);
    vi.mocked(fetch).mockResolvedValue(
      json({ code: "refresh_token_invalid" }, 401),
    );
    await expect(refreshSession()).rejects.toBeInstanceOf(ApiError);
    expect(sessionStore.get()).toBeNull();
    await expect(login("bad", "bad")).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("login and password change update session without persistent token storage", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json({
          ...session,
          user: { ...session.user, mustChangePassword: true },
        }),
      )
      .mockResolvedValueOnce(json(session));
    await login("test", "temporary");
    expect(sessionStore.get()?.user.mustChangePassword).toBe(true);
    await changePassword("temporary", "NewPassword1!");
    expect(sessionStore.get()?.user.mustChangePassword).toBe(false);
    expect(local).not.toHaveBeenCalled();
  });
  it("logout sends CSRF and always clears memory even if network fails", async () => {
    sessionStore.set(session);
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    await expect(logout()).rejects.toBeInstanceOf(ApiError);
    expect(sessionStore.get()).toBeNull();
    expect(
      new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get(
        "X-CSRF-Token",
      ),
    ).toBe("csrf-value");
  });
  it("disabling account immediately ends session", async () => {
    sessionStore.set(session);
    vi.mocked(fetch).mockResolvedValue(
      json({ title: "已停用", code: "account_disabled" }, 403),
    );
    await expect(api.get("/tasks")).rejects.toMatchObject({
      problem: { code: "account_disabled" },
    });
    expect(sessionStore.get()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not resurrect a logged-out session from an in-flight refresh", async () => {
    let complete!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const pending = refreshSession();
    sessionStore.set(null);
    complete(json(session));
    await expect(pending).rejects.toMatchObject({
      problem: { code: "session_changed" },
    });
    expect(sessionStore.get()).toBeNull();
  });
});
