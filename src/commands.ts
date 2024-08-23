import { Editor, Notice } from "obsidian";
import TodoistMarkdownPlugin from "./main";
import { parseResponse } from "./parser/json";
import { ProjectResponse } from "./api/response";

const commands = {
  "todoist-push": {
    name: "Push Todoist",
    callback: async (_: Editor, plugin: TodoistMarkdownPlugin) => {
      if (await plugin.services.todoistAPI.healthCheck()) {
        await plugin.services.todoistAPI.push();
      }
    }
  },
  "todoist-pull": {
    name: "Pull Todoist",
    callback: async (_: Editor, plugin: TodoistMarkdownPlugin) => {
      if (await plugin.services.todoistAPI.healthCheck()) {
        await plugin.services.todoistAPI.pull();
      }
    }
  }
};

export const setupCommands = (plugin: TodoistMarkdownPlugin) => {
  for (const [command, { name, callback }] of Object.entries(commands)) {
    plugin.addCommand({
      id: command,
      name,
      editorCallback: (editor: Editor) => {
        callback(editor, plugin);
      }
    });
  }
};
