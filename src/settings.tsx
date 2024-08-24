import { Notice, PluginSettingTab, Setting } from "obsidian";
import type TodoistMarkdownPlugin from "./main";
import { createReactModal } from "./ui/modal";
import { createRoot, Root } from "react-dom/client";
import type { TodoItem, Todo } from "./api/types";

export type TodoistMarkdownSettings = {
  registeredFiles: Record<string, Record<string, Todo>>;
  completedTodos: Record<string, TodoItem>;
  token: string | undefined;
  autoRefresh: boolean;
  autoRefreshInterval: number;
  directory: string;
  allowColor: boolean;
  sortTodos: boolean;
  priorityColor: {
    [key: number]: string;
  };
};

export const DEFAULT_SETTINGS: TodoistMarkdownSettings = {
  registeredFiles: {},
  completedTodos: {},
  token: undefined,
  autoRefresh: false,
  autoRefreshInterval: 0,
  directory: "todos",
  allowColor: true,
  sortTodos: false,
  priorityColor: {
    1: "#db4035",
    2: "#fad000",
    3: "#14aaf5",
    4: "#ffffff"
  }
};

export class TodoistMarkdownSettingTab extends PluginSettingTab {
  private readonly plugin: TodoistMarkdownPlugin;

  constructor(plugin: TodoistMarkdownPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;

    containerEl.empty();

    this.createGroup("Todoist");

    new Setting(containerEl)
      .setName("API Token")
      .setDesc("Your Todoist API token")
      .addButton((button) =>
        button.setButtonText("Set Token").onClick(async () => {
          createReactModal(this.plugin, "TokenValidatorModal").open();
        })
      );

    this.createGroup("General");

    new Setting(containerEl)
      .setName("Todoist Directory")
      .setDesc("Directory to store todoist files")
      .addDropdown(async (dropdown) => {
        const folders = this.plugin.app.vault
          .getAllFolders()
          .map((folder) => folder.path);

        if (
          folders.indexOf(this.plugin.settings.directory) === -1 &&
          folders.length > 0
        ) {
          this.plugin.settings.directory = folders[0];
          await this.plugin.saveSettings();
        }

        dropdown.addOptions(
          folders.reduce((acc: Record<string, string>, folder) => {
            acc[folder] = folder;
            return acc;
          }, {})
        );

        dropdown.onChange(async (value) => {
          this.plugin.settings.directory = value;
          await this.plugin.saveSettings();
        });
      });

    this.createGroup("Editor");

    new Setting(containerEl)
      .setName("Enable Color")
      .setDesc(
        "Enable color in the editor for tasks depending on their priority"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.allowColor)
          .onChange(async (value) => {
            this.plugin.settings.allowColor = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Sort Todos at top")
      .setDesc("Sort todos at the top of the markdown file")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.sortTodos)
          .onChange(async (value) => {
            this.plugin.settings.sortTodos = value;
            await this.plugin.saveSettings();
          })
      );

    this.createGroup("Miscellaneous");

    for (let i = 1; i <= 4; i++) {
      new Setting(containerEl)
        .setName(`Priority ${i} Color`)
        .setDesc(`Color for priority ${i} tasks`)
        .addColorPicker((color) =>
          color
            .setValue(this.plugin.settings.priorityColor[i])
            .onChange(async (value) => {
              this.plugin.settings.priorityColor[i] = value;
              await this.plugin.saveSettings();
            })
        )
        .addButton((button) =>
          button.setButtonText("Reset").onClick(async () => {
            this.plugin.settings.priorityColor[i] =
              DEFAULT_SETTINGS.priorityColor[i];
            await this.plugin.saveSettings();
            this.display();
          })
        );
    }
  }

  private createGroup(title: string) {
    this.containerEl.createEl("h3", { text: title });
  }
}
