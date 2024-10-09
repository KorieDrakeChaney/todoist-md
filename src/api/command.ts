import {
  ItemAddArgs,
  ItemCompleteArgs,
  ItemDeleteArgs,
  ItemUncompleteArgs,
  ItemUpdateArgs,
  NoteAddArgs,
  NoteDeleteArgs,
  NoteUpdateArgs,
  ProjectAddArgs,
  ProjectDeleteArgs,
  ProjectUpdateArgs
} from "./arguments";
import { generateUUID } from "../utils";

export type Command<T> = {
  type:
    | "item_add"
    | "item_update"
    | "item_delete"
    | "item_complete"
    | "item_uncomplete"
    | "project_delete"
    | "project_update"
    | "project_add"
    | "note_add"
    | "note_delete"
    | "note_update";
  uuid: string;
  temp_id?: string;
  args: T;
};

export const projectAdd = (
  args: ProjectAddArgs,
  temp_id: string
): Command<ProjectAddArgs> => {
  return {
    type: "project_add",
    uuid: generateUUID(),
    temp_id: temp_id,
    args: args
  };
};

export const projectUpdate = (
  args: ProjectUpdateArgs
): Command<ProjectUpdateArgs> => {
  return {
    type: "project_update",
    uuid: generateUUID(),
    args: args
  };
};

export const projectDelete = (
  args: ProjectDeleteArgs
): Command<ProjectDeleteArgs> => {
  return {
    type: "project_delete",
    uuid: generateUUID(),
    args: args
  };
};

export const itemAdd = (
  args: ItemAddArgs,
  temp_id: string
): Command<ItemAddArgs> => {
  return {
    type: "item_add",
    uuid: generateUUID(),
    temp_id: temp_id,
    args: args
  };
};

export const itemDelete = (args: ItemDeleteArgs): Command<ItemDeleteArgs> => {
  return {
    type: "item_delete",
    uuid: generateUUID(),
    args: args
  };
};

export const itemUpdate = (args: ItemUpdateArgs): Command<ItemUpdateArgs> => {
  return {
    type: "item_update",
    uuid: generateUUID(),
    args: args
  };
};

export const itemComplete = (
  args: ItemCompleteArgs
): Command<ItemCompleteArgs> => {
  return {
    type: "item_complete",
    uuid: generateUUID(),
    args: args
  };
};

export const itemUncomplete = (
  args: ItemUncompleteArgs
): Command<ItemUncompleteArgs> => {
  return {
    type: "item_uncomplete",
    uuid: generateUUID(),
    args: args
  };
};

export const noteAdd = (
  args: NoteAddArgs,
  temp_id: string
): Command<NoteAddArgs> => {
  return {
    type: "note_add",
    uuid: generateUUID(),
    temp_id: temp_id,
    args: args
  };
};

export const noteUpdate = (args: NoteUpdateArgs): Command<NoteUpdateArgs> => {
  return {
    type: "note_update",
    uuid: generateUUID(),
    args: args
  };
};

export const noteDelete = (args: NoteDeleteArgs): Command<NoteDeleteArgs> => {
  return {
    type: "note_delete",
    uuid: generateUUID(),
    args: args
  };
};
