export interface User {
  id: string;
  username: string;
  role: "PlatformAdmin" | "Annotator";
  tenantId: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
}
export interface Session {
  accessToken: string;
  expiresAtUtc: string;
  user: User;
}
export interface Tenant {
  id: string;
  name: string;
  isActive: boolean;
  createdAtUtc?: string;
}
export type TaskStatus =
  "Draft" | "Available" | "Claimed" | "Submitted" | "Correction" | "Cancelled";
export interface Segment {
  id: string;
  taskId: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}
export interface Task {
  id: string;
  tenantId: string;
  tenantName?: string;
  name: string;
  videoUrl: string;
  instructions: string | null;
  dueAtUtc: string | null;
  status: TaskStatus;
  assigneeUserId: string | null;
  assigneeUsername?: string;
  latestSubmitterUserId: string | null;
  submittedAtUtc: string | null;
  version: number;
  isOverdue: boolean;
  segments: Segment[];
  videoBoundaryVerified: boolean;
  rejectionReason?: string;
  durationMs?: number;
  warnings?: string[];
}
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
export interface Statistics {
  totalDurationMs: number;
  days: {
    date: string;
    durationMs: number;
    tenants: {
      tenantId: string;
      tenantName: string;
      durationMs: number;
      annotators: {
        annotatorId: string;
        username: string;
        durationMs: number;
        tasks: Task[];
      }[];
    }[];
  }[];
  items: Task[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
export interface Problem {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  errors?: Record<string, string[]>;
  traceId?: string;
}
