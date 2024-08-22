import { TodoistAPI } from "./api";
import TodoistMarkdownPlugin from "./main";

export type Services = {
  todoistAPI: TodoistAPI;
};

export const createServices = (plugin: TodoistMarkdownPlugin): Services => {
  return {
    todoistAPI: new TodoistAPI(plugin)
  };
};
