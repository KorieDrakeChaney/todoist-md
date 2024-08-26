import { Editor } from "obsidian";
import TodoistMarkdownPlugin from "./main";
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
  "todoist-push": {
    name: "Push",
    callback: async (_: Editor, plugin: TodoistMarkdownPlugin) => {
      if (await plugin.services.todoistAPI.healthCheck()) {
        await plugin.services.todoistAPI.push();
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
