import { PluginSettingTab, Setting } from "obsidian";
import type TodoistMarkdownPlugin from "./main";
import { createReactModal } from "./ui/modal";
import type { TodoItem, Priority } from "./api/types";

type EditorSettings = {
  showDescription: boolean;
  showColor: boolean;
  sortTodos: boolean;
};

type GeneralSettings = {
  directory: string;
};

type MiscellaneousSettings = {
  priorityColor: {
    [key: number]: string;
  };
};

type AppSettings = {
  token: string | undefined;
  registeredFiles: Record<string, Record<string, boolean>>;
  completedTodos: Record<string, TodoItem>;
  priorityMap: Record<string, Priority>;
};

export type ChangeLog = {
  previousEditorSettings: EditorSettings;
  previousProjects: Record<string, string[]>;
  fileLastModifiedTime: Record<string, number>;
};

export type TodoistMarkdownSettings = EditorSettings &
  GeneralSettings &
  MiscellaneousSettings &
  AppSettings &
  ChangeLog;

export const DEFAULT_SETTINGS: TodoistMarkdownSettings = {
  previousProjects: {},
  showDescription: true,
  priorityMap: {},
  registeredFiles: {},
  completedTodos: {},
  token: undefined,
  directory: "todos",
  showColor: true,
  sortTodos: false,
  priorityColor: {
    1: "#db4035",
    2: "#fad000",
    3: "#14aaf5",
    4: "#ffffff"
  },
  previousEditorSettings: {
    showDescription: true,
    showColor: true,
    sortTodos: false
  },
  fileLastModifiedTime: {}
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
      .setName("Show Color")
      .setDesc("Show the color of the task based on the priority in the editor")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showColor)
          .onChange(async (value) => {
            this.plugin.settings.showColor = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show Description")
      .setDesc("Show the description of the task in the editor")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showDescription)
          .onChange(async (value) => {
            this.plugin.settings.showDescription = value;
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
