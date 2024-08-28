import { PluginSettingTab, Setting } from "obsidian";
import type TodoistMarkdownPlugin from "./main";
import { createReactModal } from "./ui/modal";
import type { Todo, Priority } from "./api/types";

type EditorSettings = {
  showDescription: boolean;
  showComments: boolean;
  showColor: boolean;
  todosOnTop: boolean;
} & MiscellaneousSettings;

type GeneralSettings = {
  directory: string;
};

type MiscellaneousSettings = {
  priorityColor: {
    [key: number]: string;
  };
  commentColor: string;
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
  1: "#db4035",
  2: "#fad000",
  3: "#14aaf5",
  4: "#ffffff"
};

export const DEFAULT_SETTINGS: TodoistMarkdownSettings = {
  previousProjects: {},
  showDescription: true,
  showComments: true,
  priorityMap: {},
  registeredFiles: {},
  completedTodos: {},
  token: undefined,
  directory: "todos",
  showColor: true,
  todosOnTop: false,
  priorityColor: DEFAULT_PRIORITY_COLOR,
  commentColor: "#9191e3",
  previousEditorSettings: {
    showDescription: true,
    showColor: true,
    todosOnTop: false,
    showComments: true,
    priorityColor: DEFAULT_PRIORITY_COLOR,
    commentColor: "#9191e3"
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
      .setName("Show Comments")
      .setDesc("Show the comments of the task in the editor")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showComments)
          .onChange(async (value) => {
            this.plugin.settings.showComments = value;
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

    new Setting(containerEl)
      .setName("Comment Color")
      .setDesc("Color for comments")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.commentColor)
          .onChange(async (value) => {
            this.plugin.settings.commentColor = value;
            await this.plugin.saveSettings();
          })
      )
      .addButton((button) =>
        button.setIcon("reset").onClick(async () => {
          this.plugin.settings.commentColor = DEFAULT_SETTINGS.commentColor;
          await this.plugin.saveSettings();
          this.display();
        })
      );

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
  }

  private createGroup(title: string) {
    this.containerEl.createEl("h3", { text: title });
  }
}
