import { App, Notice, Plugin, PluginManifest } from "obsidian";
import {
  DEFAULT_SETTINGS,
  type TodoistMarkdownSettings,
  TodoistMarkdownSettingTab
} from "./settings";
import { createServices, Services } from "./services";
import { createReactModal } from "./ui/modal";
import { setupCommands } from "./commands";

export default class TodoistMarkdownPlugin extends Plugin {
  readonly services: Services;
  settings: TodoistMarkdownSettings;
  constructor(app: App, pluginManifest: PluginManifest) {
    super(app, pluginManifest);

    this.services = createServices(this);
    this.addSettingTab(new TodoistMarkdownSettingTab(this));

    setupCommands(this);
  }

  async onload() {
    this.registerMarkdownCodeBlockProcessor(
      "todomd",
      async (source, el, ctx) => {
        this.services.todoistAPI.pushCodeBlock(source, el, ctx);
      }
    );

    await this.loadSettings();

    if (!(await this.services.todoistAPI.healthCheck())) {
      if (this.settings.token) {
        this.settings.token = undefined;
        await this.saveSettings();
      }
      createReactModal(this, "TokenValidatorModal").open();
    } else {
      await this.services.todoistAPI.pull();
    }

    this.setupRibbons();
  }

  private setupRibbons() {
    this.addRibbonIcon("sync", "Sync with Todoist", async () => {
      if (this.settings.token) {
        await this.services.todoistAPI.pull();
      } else {
        createReactModal(this, "TokenValidatorModal").open();
      }
    });

    this.addRibbonIcon("step-forward", "Push to Todoist", async () => {
      if (this.settings.token) {
        await this.services.todoistAPI.push();
      } else {
        createReactModal(this, "TokenValidatorModal").open();
      }
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
