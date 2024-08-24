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

export type TodoistColor =
  | "berry_red"
  | "red"
  | "orange"
  | "yellow"
  | "olive_green"
  | "lime_green"
  | "green"
  | "mint_green"
  | "teal"
  | "sky_blue"
  | "light_blue"
  | "blue"
  | "grape"
  | "violet"
  | "lavender"
  | "magenta"
  | "salmon"
  | "charcoal"
  | "grey"
  | "taupe";

export type TodoistViewStyle = "list" | "board";
