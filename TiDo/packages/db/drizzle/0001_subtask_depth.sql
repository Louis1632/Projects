-- Tasks support exactly one level of subtasks. The API checks this too; the trigger keeps
-- the rule true even for writes that bypass the service layer.
CREATE OR REPLACE FUNCTION tido_enforce_subtask_depth() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_task_id IS NOT NULL THEN
    IF NEW.parent_task_id = NEW.id THEN
      RAISE EXCEPTION 'a task cannot be its own subtask'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tasks_subtask_depth';
    END IF;
    IF EXISTS (SELECT 1 FROM tasks WHERE id = NEW.parent_task_id AND parent_task_id IS NOT NULL) THEN
      RAISE EXCEPTION 'subtasks cannot have subtasks'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tasks_subtask_depth';
    END IF;
    IF EXISTS (SELECT 1 FROM tasks WHERE parent_task_id = NEW.id) THEN
      RAISE EXCEPTION 'a task with subtasks cannot become a subtask'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tasks_subtask_depth';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER tasks_subtask_depth
  BEFORE INSERT OR UPDATE OF parent_task_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION tido_enforce_subtask_depth();
