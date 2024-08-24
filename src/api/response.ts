import type {
  DueDate,
  Priority,
  TodoistDuration,
  TodoistReaction,
  TodoistColor,
  TodoistViewStyle
} from "./types";

export type TodoistFileAttachment = {
  file_name: string;
  file_size: number;
  file_type: string;
  file_url: string;
  upload_state: "pending" | "completed";
};

export type ProjectResponse = {
  id: string;
  name: string;
  color: TodoistColor;
  parent_id: string | null;
  child_order: number;
  collapsed: boolean;
  shared: boolean;
  can_assign_tasks: boolean;
  is_deleted: boolean;
  is_archived: boolean;
  is_favorite: boolean;
  sync_id: number;
  inbox_project: boolean;
  team_inbox: boolean;
  view_style: TodoistViewStyle;
};

export type SectionResponse = {
  id: string;
  name: string;
  project_id: string;
  section_order: number;
  collapsed: number;
  sync_id: string;
  is_deleted: boolean;
  is_archived: boolean;
  archived_at: string | null;
  added_at: string;
};

export type LabelResponse = {
  id: string;
  name: string;
  color: TodoistColor;
  item_order: number;
  is_deleted: boolean;
  is_favorite: boolean;
};

export type ItemResponse = {
  id: string;
  user_id: string;
  project_id: string;
  content: string;
  description: string;
  due: DueDate;
  priority: Priority;
  parent_id: string;
  child_order: number;
  section_id: string;
  day_order: number;
  collapsed: number;
  labels: string[];
  added_by_uid: string;
  assigned_by_uid: string;
  responsible_uid: string;
  checked: number;
  is_deleted: boolean;
  sync_id: string;
  completed_at: string;
  added_at: string;
  duration: TodoistDuration;
};

export type NoteResponse = {
  id: string;
  posted_uid: string;
  item_id: string;
  content: string;
  file_attachment: TodoistFileAttachment;
  uids_to_notify: string[];
  is_deleted: boolean;
  posted_at: string;
  reactions: TodoistReaction;
};

export type ProjectNoteResponse = {
  id: string;
  posted_uid: string;
  project_id: string;
  content: string;
  file_attachment: TodoistFileAttachment;
  uids_to_notify: string[];
  is_deleted: boolean;
  posted_at: string;
  reactions: TodoistReaction;
};

export type Filter = {
  id: string;
  name: string;
  query: string;
  color: TodoistColor;
  item_order: number;
  is_deleted: boolean;
  is_favorite: boolean;
};

export type CompletedItemResponse = {
  id: string;
  task_id: string;
  user_id: string;
  project_id: string;
  content: string;
  completed_at: string;
  note_count: number;
  meta_data: string;
  item_object: ItemResponse;
};
