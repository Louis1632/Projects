import { z } from 'zod';

/** Shared, transport-safe contracts. Database models deliberately stay in @tido/db. */

export const idSchema = z.uuid();
export const dateOnlySchema = z.iso.date({ error: 'Expected a date in YYYY-MM-DD format' });
export const dateTimeSchema = z.iso.datetime({ offset: true });
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));
export const nonEmptyTextSchema = z.string().trim().min(1).max(500);
export const notesSchema = z.string().max(20_000);
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(1024, 'Use at most 1024 characters');
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #RRGGBB color');

export const workspaceRoleSchema = z.enum(['owner', 'member']);
export const taskStatusSchema = z.enum(['todo', 'in_progress', 'done']);
export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export const recurrenceScopeSchema = z.enum(['occurrence', 'future', 'series']);

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Recurrence rules
// ---------------------------------------------------------------------------

/**
 * A single RFC 5545 RRULE value (without the "RRULE:" prefix or DTSTART). Tasks are
 * date-only, so time-of-day parts and sub-daily frequencies are rejected here; the API
 * performs the full parse and expansion check.
 */
export const recurrenceRuleSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(10)
  .max(1_024)
  .refine((rule) => !/[\r\n]/.test(rule), 'A recurrence rule must be a single line')
  .refine(
    (rule) => /(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/.test(rule),
    'Expected a rule such as FREQ=WEEKLY;BYDAY=MO',
  )
  .refine(
    (rule) => !/(?:^|;)(BYHOUR|BYMINUTE|BYSECOND|DTSTART|TZID)=/.test(rule),
    'Tasks are scheduled by date; time-of-day rule parts are not supported',
  );

export const recurrenceInputSchema = z.object({
  rrule: recurrenceRuleSchema,
  /** First date the series may occur on. Defaults to the task due date, then today. */
  startsOn: dateOnlySchema.optional(),
});

// ---------------------------------------------------------------------------
// Auth and members
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(1024),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: passwordSchema,
});

export const tokenSchema = z.string().min(32).max(256);

export const inviteCreateSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1).max(120),
  role: workspaceRoleSchema.default('member'),
});

/** Accepts an invite or a password-reset link; both let the person choose a password. */
export const tokenAcceptSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(120).optional(),
});

export const tokenLookupSchema = z.object({ token: tokenSchema });

export const memberRoleUpdateSchema = z.object({ role: workspaceRoleSchema });

export const memberSchema = z.object({
  id: idSchema,
  email: z.string(),
  displayName: z.string(),
  role: workspaceRoleSchema,
  active: z.boolean(),
  /** True while an invited member has not yet chosen a password. */
  pending: z.boolean(),
  joinedAt: dateTimeSchema,
});

export const workspaceSchema = z.object({
  id: idSchema,
  name: z.string(),
  timezone: z.string(),
});

export const sessionUserSchema = z.object({
  id: idSchema,
  email: z.string(),
  displayName: z.string(),
  role: workspaceRoleSchema,
  workspace: workspaceSchema,
});

export const accountLinkSchema = z.object({
  url: z.url(),
  expiresAt: dateTimeSchema,
});

export const tokenInfoSchema = z.object({
  email: z.string(),
  displayName: z.string(),
  kind: z.enum(['invite', 'password_reset']),
});

// ---------------------------------------------------------------------------
// Projects, sections, labels
// ---------------------------------------------------------------------------

export const projectCreateSchema = z.object({
  name: nonEmptyTextSchema.max(120),
  description: z.string().max(2_000).nullable().optional(),
  color: colorSchema.nullable().optional(),
});
export const projectUpdateSchema = projectCreateSchema.partial().extend({
  archived: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  revision: z.number().int().min(1),
});

export const sectionCreateSchema = z.object({
  name: nonEmptyTextSchema.max(120),
});
export const sectionUpdateSchema = sectionCreateSchema.partial().extend({
  archived: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  revision: z.number().int().min(1),
});

export const labelCreateSchema = z.object({
  name: nonEmptyTextSchema.max(60),
  color: colorSchema.nullable().optional(),
});
export const labelUpdateSchema = labelCreateSchema.partial();

export const labelSchema = z.object({
  id: idSchema,
  name: z.string(),
  color: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const taskFieldsSchema = z.object({
  title: nonEmptyTextSchema,
  notes: notesSchema.nullable().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: idSchema.nullable().optional(),
  startDate: dateOnlySchema.nullable().optional(),
  dueDate: dateOnlySchema.nullable().optional(),
  labelIds: z.array(idSchema).max(20).optional(),
});

function checkDateOrder(
  task: { startDate?: string | null; dueDate?: string | null },
  context: z.RefinementCtx,
) {
  if (task.startDate && task.dueDate && task.startDate > task.dueDate) {
    context.addIssue({
      code: 'custom',
      path: ['dueDate'],
      message: 'The due date cannot be before the start date',
    });
  }
}

export const taskCreateSchema = taskFieldsSchema
  .extend({
    sectionId: idSchema,
    parentTaskId: idSchema.nullable().optional(),
    recurrence: recurrenceInputSchema.nullable().optional(),
    /** For a subtask of a recurring task: also add it to later occurrences. */
    repeatSubtask: z.boolean().optional(),
  })
  .superRefine((task, context) => {
    checkDateOrder(task, context);
    if (task.parentTaskId && task.recurrence) {
      context.addIssue({
        code: 'custom',
        path: ['recurrence'],
        message: 'A subtask repeats with its parent task',
      });
    }
  });

export const taskUpdateSchema = taskFieldsSchema
  .partial()
  .extend({
    revision: z.number().int().min(1),
    /** Required context when the task is an occurrence of a recurring series. */
    scope: recurrenceScopeSchema.optional(),
    /** Set a rule to make a task repeat, change the rule, or null to stop repeating. */
    recurrence: recurrenceInputSchema.nullable().optional(),
  })
  .superRefine(checkDateOrder);

export const taskMoveSchema = z.object({
  sectionId: idSchema,
  position: z.number().int().min(0),
  revision: z.number().int().min(1),
});

export const taskCompletionSchema = z.object({
  completed: z.boolean(),
});

export const taskDeleteQuerySchema = z.object({
  scope: recurrenceScopeSchema.default('occurrence'),
});

const csvOrArray = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value),
    z.array(item).min(1),
  );

export const taskFilterSchema = z.object({
  projectId: idSchema.optional(),
  sectionId: idSchema.optional(),
  assigneeId: z.union([idSchema, z.literal('none')]).optional(),
  labelId: idSchema.optional(),
  status: csvOrArray(taskStatusSchema).optional(),
  priority: csvOrArray(taskPrioritySchema).optional(),
  dueFrom: dateOnlySchema.optional(),
  dueTo: dateOnlySchema.optional(),
  query: z.string().trim().max(200).optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const calendarQuerySchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
    projectId: idSchema.optional(),
    assigneeId: idSchema.optional(),
  })
  .refine((query) => query.from <= query.to, {
    path: ['to'],
    message: '"to" must be on or after "from"',
  });

export const taskRecurrenceSchema = z.object({
  seriesId: idSchema,
  rrule: z.string(),
  startsOn: dateOnlySchema,
  occurrenceDate: dateOnlySchema.nullable(),
  /** True when this occurrence was edited on its own and no longer follows the series. */
  detached: z.boolean(),
});

const baseTaskSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  sectionId: idSchema,
  parentTaskId: idSchema.nullable(),
  title: z.string(),
  notes: z.string().nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assigneeId: idSchema.nullable(),
  startDate: dateOnlySchema.nullable(),
  dueDate: dateOnlySchema.nullable(),
  position: z.number().int(),
  revision: z.number().int(),
  completedAt: dateTimeSchema.nullable(),
  completedBy: idSchema.nullable(),
  archivedAt: dateTimeSchema.nullable(),
  createdBy: idSchema,
  updatedBy: idSchema.nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  labels: z.array(labelSchema),
  recurrence: taskRecurrenceSchema.nullable(),
});

export const subtaskSchema = baseTaskSchema;
export const taskSchema = baseTaskSchema.extend({
  subtasks: z.array(subtaskSchema),
});

export const sectionSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  name: z.string(),
  position: z.number().int(),
  revision: z.number().int(),
  archivedAt: dateTimeSchema.nullable(),
});

export const projectSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  color: z.string().nullable(),
  position: z.number().int(),
  revision: z.number().int(),
  archivedAt: dateTimeSchema.nullable(),
});

export const sectionWithTasksSchema = sectionSchema.extend({ tasks: z.array(taskSchema) });
export const projectWithSectionsSchema = projectSchema.extend({
  sections: z.array(sectionWithTasksSchema),
});

export const dashboardSchema = z.object({
  projects: z.array(projectWithSectionsSchema),
  members: z.array(memberSchema),
  labels: z.array(labelSchema),
});

export const completionEntrySchema = z.object({
  action: z.enum(['completed', 'reopened']),
  occurredAt: dateTimeSchema,
  actorId: idSchema.nullable(),
  actorName: z.string().nullable(),
});

export const okSchema = z.object({ ok: z.literal(true) });

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
export type Role = z.infer<typeof workspaceRoleSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type RecurrenceScope = z.infer<typeof recurrenceScopeSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type InviteCreateInput = z.input<typeof inviteCreateSchema>;
export type TokenAcceptInput = z.infer<typeof tokenAcceptSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type AccountLink = z.infer<typeof accountLinkSchema>;
export type TokenInfo = z.infer<typeof tokenInfoSchema>;
export type Label = z.infer<typeof labelSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type SectionCreateInput = z.infer<typeof sectionCreateSchema>;
export type SectionUpdateInput = z.infer<typeof sectionUpdateSchema>;
export type LabelCreateInput = z.infer<typeof labelCreateSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type TaskMoveInput = z.infer<typeof taskMoveSchema>;
export type TaskFilter = z.infer<typeof taskFilterSchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
export type TaskRecurrence = z.infer<typeof taskRecurrenceSchema>;
export type Subtask = z.infer<typeof subtaskSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Project = z.infer<typeof projectSchema>;
export type SectionWithTasks = z.infer<typeof sectionWithTasksSchema>;
export type ProjectWithSections = z.infer<typeof projectWithSectionsSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type CompletionEntry = z.infer<typeof completionEntrySchema>;
