import { App, Plugin, PluginManifest, TextFileView } from "obsidian";
import {
  DEFAULT_SETTINGS,
  type TodoistMarkdownSettings,
  TodoistMarkdownSettingTab
} from "./settings";
import { createServices, Services } from "./services";
import { createReactModal } from "./ui/modal";
import { setupCommands } from "./commands";
import { EphemeralState } from "./types";

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
    let called = false;
    this.registerMarkdownCodeBlockProcessor("todomd", async (_, el, ctx) => {
      if (called) {
        return;
      }
      let activeView = this.app.workspace.getActiveViewOfType(TextFileView);

      if (activeView) {
        let ephemeralState = activeView.getEphemeralState() as EphemeralState;

        if (ephemeralState) {
          let sectionInfo = ctx.getSectionInfo(el);
          const sourcePath = ctx.sourcePath;
          let { cursor } = ephemeralState;
          let { from, to } = cursor;
          let { lineEnd } = sectionInfo;

          if (from.line > lineEnd) {
            called = true;
            await this.services.todoistAPI.pushCodeBlock(
              sectionInfo,
              sourcePath
            );
            called = false;
          }
        }
      }
    });

    await this.loadSettings();

    if (!(await this.services.todoistAPI.healthCheck())) {
      if (this.settings.token) {
        this.settings.token = undefined;
        await this.saveSettings();
      }
      createReactModal(this, "TokenValidatorModal").open();
    } else {
      await this.services.todoistAPI.softPull();
    }

    this.setupRibbons();
  }

  private setupRibbons() {
    this.addRibbonIcon("sync", "Pull from Todoist (Non-Forced)", async () => {
      if (this.settings.token) {
        await this.services.todoistAPI.softPull();
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
