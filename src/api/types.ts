export type Todo = {
  id: string | null;
  content: string;
  completed: boolean;
  due?: DueDate;
  priority?: Priority;
  labels: string[];
};

export type TodoItem = {
  id: string | null;
  content: string;
  completed: boolean;
  due?: DueDate;
  priority?: Priority;
  labels: string[];
  project_id: string;
};

export type Project = {
  name: string;
  body: (string | Todo)[];
  filePath: string;
  needsUpdate: boolean;
};

export type DueDate = {
  date: string;
  timezone: string | null;
  string: string;
  lang: string;
  is_recurring: boolean;
};

export type TodoistUnit = "minute" | "day";

export type TodoistDuration = {
  amount: number;
  unit: TodoistUnit;
};

export type TodoistReaction = Record<string, string[]>;

export type Priority = 1 | 2 | 3 | 4;
