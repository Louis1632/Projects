import { auditEvents, type Executor } from '@tido/db';

export interface AuditEntry {
  workspaceId: string | null;
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

export async function audit(exec: Executor, entry: AuditEntry): Promise<void> {
  await exec.insert(auditEvents).values({
    workspaceId: entry.workspaceId,
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata,
    ipAddress: entry.ip,
  });
}
