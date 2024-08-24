import { Editor, Notice } from "obsidian";
import TodoistMarkdownPlugin from "./main";
import { parseResponse } from "./parser/json";
import { ProjectResponse } from "./api/response";
import { createReactModal } from "./ui/modal";

const commands = {
  "todoist-soft-pull": {
    name: "Soft-Pull",
    callback: async (_: Editor, plugin: TodoistMarkdownPlugin) => {
      if (await plugin.services.todoistAPI.healthCheck()) {
        await plugin.services.todoistAPI.softPull();
      } else {
        createReactModal(plugin, "TokenValidatorModal").open();
      }
    }
  },
  "todoist-forced-pull": {
    name: "Forced-Pull",
    callback: async (_: Editor, plugin: TodoistMarkdownPlugin) => {
      if (await plugin.services.todoistAPI.healthCheck()) {
        await plugin.services.todoistAPI.forcedPull();
      } else {
        createReactModal(plugin, "TokenValidatorModal").open();
      }
    }
  },
  "todoist-soft-push": {
    name: "Soft-Push",
    callback: async (_: Editor, plugin: TodoistMarkdownPlugin) => {
      if (await plugin.services.todoistAPI.healthCheck()) {
        await plugin.services.todoistAPI.softPush();
      } else {
        createReactModal(plugin, "TokenValidatorModal").open();
      }
    }
  },

  "todoist-forced-push": {
    name: "Forced-Push",
    callback: async (_: Editor, plugin: TodoistMarkdownPlugin) => {
      if (await plugin.services.todoistAPI.healthCheck()) {
        await plugin.services.todoistAPI.forcedPush();
      } else {
        createReactModal(plugin, "TokenValidatorModal").open();
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
