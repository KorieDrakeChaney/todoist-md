import type {
  DueDate,
  TodoistDuration,
  TodoistColor,
  TodoistViewStyle,
  Priority
} from "./types";

export type ProjectAddArgs = {
  name: string;
  color?: TodoistColor;
  parent_id?: string;
  child_order?: number;
  is_favorite?: boolean;
  view_style?: TodoistViewStyle;
};

export type ProjectUpdateArgs = {
  id: string;
  name?: string;
  color?: TodoistColor;
  collapsed?: boolean;
  is_favorite?: boolean;
  view_style?: TodoistViewStyle;
};

export type ProjectDeleteArgs = {
  id: string;
};

export type ItemAddArgs = {
  content: string;
  description?: string;
  project_id?: string;
  due?: DueDate;
  priority?: number;
  parent_id?: string;
  child_order?: number;
  section_id?: string;
  day_order?: number;
  labels?: string[];
  assigned_by_uid?: string;
  responsible_uid?: string;
  auto_reminder?: boolean;
  auto_parse_labels?: boolean;
  duration?: TodoistDuration;
};

export type ItemUpdateArgs = {
  id: string;
  content?: string;
  description?: string;
  due?: DueDate;
  priority?: Priority;
  collapsed?: number;
  labels?: string[];
  assigned_by_uid?: string;
  responsible_uid?: string;
  day_order?: number;
  duration?: TodoistDuration;
};

export type ItemCompleteArgs = {
  id: string;
};

export type ItemUncompleteArgs = {
  id: string;
};

export type ItemDeleteArgs = {
  id: string;
};
