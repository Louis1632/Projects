import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
/** Task dates are calendar days, never instants. */
const day = (name: string) => date(name, { mode: 'string' });

export const workspaceRole = pgEnum('workspace_role', ['owner', 'member']);
export const taskStatus = pgEnum('task_status', ['todo', 'in_progress', 'done']);
export const taskPriority = pgEnum('task_priority', ['low', 'medium', 'high', 'urgent']);
export const accountTokenKind = pgEnum('account_token_kind', ['invite', 'password_reset']);
export const completionAction = pgEnum('completion_action', ['completed', 'reopened']);
export const recurrenceExceptionKind = pgEnum('recurrence_exception_kind', [
  'skipped',
  'overridden',
]);

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Always stored lower-cased. */
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    /** Null until an invited user accepts their invite. */
    passwordHash: text('password_hash'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('users_email_key').on(table.email),
    check('users_email_lowercase', sql`${table.email} = lower(${table.email})`),
  ],
);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Africa/Johannesburg'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('workspace_members_user_idx').on(table.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** HMAC-SHA256 of the opaque cookie token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Absolute lifetime limit, independent of activity. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    ipAddress: inet('ip_address'),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
  ],
);

export const accountTokens = pgTable(
  'account_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: accountTokenKind('kind').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('account_tokens_token_hash_key').on(table.tokenHash),
    index('account_tokens_user_idx').on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// Planning hierarchy: workspace → project → section → task → subtask
// ---------------------------------------------------------------------------

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color'),
    position: integer('position').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('projects_workspace_idx').on(table.workspaceId, table.position)],
);

export const sections = pgTable(
  'sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('sections_project_idx').on(table.projectId, table.position)],
);

export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('labels_workspace_name_key').on(table.workspaceId, sql`lower(${table.name})`),
  ],
);

/**
 * A recurring series is the template from which dated task occurrences are generated.
 * Occurrences are ordinary task rows linked back by `recurrence_series_id`.
 */
export const recurrenceSeries = pgTable(
  'recurrence_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    /** RFC 5545 RRULE value, e.g. FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=12 */
    rrule: text('rrule').notNull(),
    startsOn: day('starts_on').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    priority: taskPriority('priority').notNull().default('medium'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    labelIds: uuid('label_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Titles of the direct subtasks cloned into each new occurrence. */
    subtaskTitles: jsonb('subtask_titles').$type<string[]>().notNull().default([]),
    /** Occurrences exist for every rule date up to and including this day. */
    generatedThrough: day('generated_through'),
    isActive: boolean('is_active').notNull().default(true),
    splitFromId: uuid('split_from_id').references((): AnyPgColumn => recurrenceSeries.id, {
      onDelete: 'set null',
    }),
    revision: integer('revision').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('recurrence_series_workspace_idx').on(table.workspaceId, table.isActive)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => tasks.id, {
      onDelete: 'cascade',
    }),
    recurrenceSeriesId: uuid('recurrence_series_id').references(() => recurrenceSeries.id, {
      onDelete: 'set null',
    }),
    /** The rule date this occurrence represents; stays fixed even if the due date moves. */
    occurrenceDate: day('occurrence_date'),
    /** True when edited individually, so series-wide edits no longer apply to it. */
    isDetached: boolean('is_detached').notNull().default(false),
    title: text('title').notNull(),
    notes: text('notes'),
    status: taskStatus('status').notNull().default('todo'),
    priority: taskPriority('priority').notNull().default('medium'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    startDate: day('start_date'),
    dueDate: day('due_date'),
    position: integer('position').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('tasks_section_idx').on(table.sectionId, table.parentTaskId, table.position),
    index('tasks_parent_idx').on(table.parentTaskId),
    index('tasks_workspace_due_idx').on(table.workspaceId, table.dueDate),
    index('tasks_assignee_idx').on(table.assigneeId),
    uniqueIndex('tasks_series_occurrence_key').on(table.recurrenceSeriesId, table.occurrenceDate),
    check(
      'tasks_dates_ordered',
      sql`${table.startDate} IS NULL OR ${table.dueDate} IS NULL OR ${table.startDate} <= ${table.dueDate}`,
    ),
    check(
      'tasks_done_has_completion',
      sql`(${table.status} = 'done') = (${table.completedAt} IS NOT NULL)`,
    ),
    check(
      'tasks_occurrence_has_series',
      sql`${table.occurrenceDate} IS NULL OR ${table.recurrenceSeriesId} IS NOT NULL`,
    ),
  ],
);

export const taskLabels = pgTable(
  'task_labels',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.labelId] }),
    index('task_labels_label_idx').on(table.labelId),
  ],
);

export const taskCompletions = pgTable(
  'task_completions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    action: completionAction('action').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('task_completions_task_idx').on(table.taskId, table.occurredAt)],
);

export const recurrenceExceptions = pgTable(
  'recurrence_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => recurrenceSeries.id, { onDelete: 'cascade' }),
    occurrenceDate: day('occurrence_date').notNull(),
    kind: recurrenceExceptionKind('kind').notNull(),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('recurrence_exceptions_series_date_key').on(table.seriesId, table.occurrenceDate),
  ],
);

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ipAddress: inet('ip_address'),
    createdAt: createdAt(),
  },
  (table) => [index('audit_events_workspace_idx').on(table.workspaceId, table.createdAt)],
);
