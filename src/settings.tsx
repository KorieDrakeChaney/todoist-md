import { PluginSettingTab, Setting } from "obsidian";
import type TodoistMarkdownPlugin from "./main";
import { createReactModal } from "./ui/modal";
import type { Todo, Priority } from "./api/types";

type EditorSettings = {
  showDescription: boolean;
  showTaskColor: boolean;
  showDueColor: boolean;
  todosOnTop: boolean;
  sortDate: 1 | 0 | -1;
} & MiscellaneousSettings;

type GeneralSettings = {
  directory: string;
};

type MiscellaneousSettings = {
  priorityColor: {
    [key: number]: string;
  };
  dueColor: {
    [key: string]: string;
  };
};

type AppSettings = {
  token: string | undefined;
  registeredFiles: Record<string, Record<string, boolean>>;
  completedTodos: Record<string, Todo>;
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

const DEFAULT_PRIORITY_COLOR = {
  1: "#9b6feb",
  2: "#fad000",
  3: "#14aaf5",
  4: "#ffffff"
};

const DEFAULT_DUE_COLOR = {
  past: "#f7b0ab",
  today: "#6ffc97",
  tomorrow: "#74e8f7",
  within_week: "#a68eed",
  future: "#bdffcc"
};

export const DEFAULT_SETTINGS: TodoistMarkdownSettings = {
  previousProjects: {},
  showDescription: true,
  priorityMap: {},
  registeredFiles: {},
  completedTodos: {},
  token: undefined,
  directory: "todos",
  todosOnTop: false,
  showDueColor: true,
  showTaskColor: true,
  sortDate: 0,
  dueColor: DEFAULT_DUE_COLOR,
  priorityColor: DEFAULT_PRIORITY_COLOR,
  previousEditorSettings: {
    showDescription: true,
    sortDate: 0,
    showDueColor: true,
    showTaskColor: true,
    todosOnTop: false,
    dueColor: DEFAULT_DUE_COLOR,
    priorityColor: DEFAULT_PRIORITY_COLOR
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
      .setName("Show Task Color")
      .setDesc("Show the color of the task based on the priority in the editor")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showTaskColor)
          .onChange(async (value) => {
            this.plugin.settings.showTaskColor = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show Due Color")
      .setDesc("Show the color of the task based on the due date in the editor")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showDueColor)
          .onChange(async (value) => {
            this.plugin.settings.showDueColor = value;
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
      .setName("Sort Date")
      .setDesc("Sort the todos by date")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            Ascending: "Ascending",
            Descending: "Descending",
            Disabled: "Disabled"
          })
          .setValue(
            this.plugin.settings.sortDate === 1
              ? "Ascending"
              : this.plugin.settings.sortDate === -1
              ? "Descending"
              : "Disabled"
          )
          .onChange(async (value) => {
            this.plugin.settings.sortDate =
              value === "Ascending" ? 1 : value === "Descending" ? -1 : 0;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show Todos on Top")
      .setDesc("Show todos at the top of the markdown file")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.todosOnTop)
          .onChange(async (value) => {
            this.plugin.settings.todosOnTop = value;
            await this.plugin.saveSettings();
          })
      );

    this.createGroup("Miscellaneous");

    this.createSection("Priority Color");

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
          button.setIcon("reset").onClick(async () => {
            this.plugin.settings.priorityColor[i] =
              DEFAULT_SETTINGS.priorityColor[i];
            await this.plugin.saveSettings();
            this.display();
          })
        );
    }

    this.createSection("Due Color");

    Object.entries(this.plugin.settings.dueColor).forEach(([key, _]) => {
      new Setting(containerEl)
        .setName(`${key} Color`)
        .setDesc(`Color for ${key} tasks`)
        .addColorPicker((color) =>
          color
            .setValue(this.plugin.settings.dueColor[key])
            .onChange(async (value) => {
              this.plugin.settings.dueColor[key] = value;
              await this.plugin.saveSettings();
            })
        )
        .addButton((button) =>
          button.setIcon("reset").onClick(async () => {
            this.plugin.settings.dueColor[key] = DEFAULT_SETTINGS.dueColor[key];
            await this.plugin.saveSettings();
            this.display();
          })
        );
    });
  }

  private createGroup(title: string) {
    this.containerEl.createEl("h3", { text: title });
  }

  private createSection(title: string) {
    this.containerEl.createEl("h4", { text: title });
  }
}
