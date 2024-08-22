import TodoistMarkdownPlugin from "src/main";
import { obsidianFetch, RequestParams, WebResponse } from "./fetch";
import {
  CompletedItemResponse,
  Filter,
  ItemResponse,
  LabelResponse,
  NoteResponse,
  ProjectNoteResponse,
  ProjectResponse,
  SectionResponse
} from "./response";
import {
  itemAdd,
  itemComplete,
  itemDelete,
  itemUncomplete,
  itemUpdate,
  projectAdd,
  projectDelete,
  projectUpdate,
  type Command
} from "./command";

const syncUrl = "https://api.todoist.com/sync/v9/sync";
const restUrl = "https://api.todoist.com/rest/v2";
const completedUrl = "https://api.todoist.com/sync/v9/completed/get_all";
import {
  ItemAddArgs,
  ItemCompleteArgs,
  ItemDeleteArgs,
  ItemUpdateArgs,
  ProjectAddArgs,
  ProjectDeleteArgs,
  ProjectUpdateArgs
} from "./arguments";
import { parseResponse } from "src/parser/json";
import { MarkdownPostProcessorContext, Notice, Vault } from "obsidian";
import {
  compareDueDates,
  generateUUID,
  getUpdatedItem,
  parseTodos,
  parseFile,
  parseTodo,
  shouldComplete,
  shouldUncomplete,
  sortTodos,
  insertTextAtPosition
} from "./utils";
import { Priority, Project, Todo, TodoItem } from "./types";

type ResourceTypes =
  | "projects"
  | "items"
  | "lnotes"
  | "project_notes"
  | "sections"
  | "labels"
  | "filters"
  | "-projects"
  | "-items"
  | "-notes"
  | "-project_notes"
  | "-sections"
  | "-labels"
  | "-filters"
  | "all";

type TodoistSyncResponse = {
  sync_token: string;
  projects?: ProjectResponse[];
  items?: ItemResponse[];
  notes?: NoteResponse[];
  project_notes?: ProjectNoteResponse[];
  sections?: SectionResponse[];
  labels?: LabelResponse[];
  filters?: Filter[];
  temp_id_mapping: Record<string, string>;
};

type TodoistCompletedResponse = {
  items: CompletedItemResponse[];
};

type ItemMap = Record<string, TodoItem>;
type ProjectMap = Record<string, ProjectResponse>;

type ProjectDiffMap = Record<string, Project>;

type FileData = {
  projName: string;
  projId: string | null;
  body: (string | Todo)[];
  filePath: string;
}[];

export class TodoistAPI {
  private readonly vault: Vault;
  private readonly plugin: TodoistMarkdownPlugin;
  private syncToken: string | null = null;
  private commands: Command<unknown>[] = [];

  private syncedProjects: ProjectMap = {};
  private syncedItems: ItemMap = {};

  private temp_id_mapping: Record<string, string> = {};
  private inbox_id: string | null = null;

  constructor(plugin: TodoistMarkdownPlugin) {
    this.plugin = plugin;
    this.vault = plugin.app.vault;
  }

  private clear() {
    this.commands = [];
    this.syncedItems = {};
  }

  async pull() {
    new Notice("Syncing Todoist projects...");
    try {
      await this.sync();
      const diff = await this.getDiff();
      await this.writeDiff(diff);
      new Notice("Todoist projects synced!");
    } catch (error: unknown) {
      new Notice(error.toString());
    }

    this.clear();
  }

  async push() {
    new Notice("Syncing Todoist projects...");
    try {
      const diff = await this.getDiff(true);
      await this.sync();
      await this.writeDiff(diff);
      new Notice("Todoist projects synced!");
    } catch (error) {
      new Notice("Error syncing Todoist projects");
    }

    this.clear();
  }

  async healthCheck(potentialToken?: string): Promise<boolean> {
    let token = potentialToken ?? this.plugin.settings.token;
    try {
      const params = {
        url: `${restUrl}/projects`,
        headers: {
          Authorization: `Bearer ${token}`
        },
        method: "GET"
      };

      const response = await obsidianFetch(params);

      if (response.status === 403 || response.status === 401) {
        throw new Error("Invalid API token");
      }

      return true;
    } catch (error: unknown) {
      new Notice(error.toString());
      return false;
    }
  }

  async sync(useSyncToken: boolean = false): Promise<TodoistSyncResponse> {
    if (!this.plugin.settings.token) {
      throw new Error("No token provided");
    }

    const params: RequestParams = {
      url: completedUrl,
      headers: {
        Authorization: `Bearer ${this.plugin.settings.token}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      method: "POST",
      body: ""
    };

    params.body = new URLSearchParams({
      annotate_items: "true"
    }).toString();

    const completedResponse = await obsidianFetch(params);

    const completedData = parseResponse<TodoistCompletedResponse>(
      completedResponse.body
    );

    await this.syncCompletedItems(completedData.items);

    params.url = syncUrl;
    params.body = this.getBody(useSyncToken);
    const response = await obsidianFetch(params);

    if (response.status !== 200) {
      throw new Error(`Error syncing Todoist projects: ${response.body}`);
    }

    const data = parseResponse<TodoistSyncResponse>(response.body);

    for (const project of data.projects ?? []) {
      if (project.inbox_project) this.inbox_id = project.id;
    }

    if (data.projects) this.syncProjects(data.projects);

    if (data.items) this.syncItems(data.items);

    this.syncToken = data.sync_token;
    this.temp_id_mapping = data.temp_id_mapping;

    return data;
  }

  projectAdd(args: ProjectAddArgs, tempId?: string): string {
    const temp_id = tempId ?? generateUUID();
    this.commands.push(projectAdd(args, temp_id));
    return temp_id;
  }

  projectUpdate(args: ProjectUpdateArgs): void {
    this.commands.push(projectUpdate(args));
  }

  projectDelete(args: ProjectDeleteArgs): void {
    this.commands.push(projectDelete(args));
  }

  itemAdd(args: ItemAddArgs, tempId?: string): string {
    const temp_id = tempId ?? generateUUID();
    this.commands.push(itemAdd(args, temp_id));
    return temp_id;
  }

  itemDelete(args: ItemDeleteArgs): void {
    this.commands.push(itemDelete(args));
  }

  itemUpdate(args: ItemUpdateArgs): void {
    this.commands.push(itemUpdate(args));
  }

  itemComplete(args: ItemCompleteArgs): void {
    this.commands.push(itemComplete(args));
  }

  itemUncomplete(args: ItemCompleteArgs): void {
    this.commands.push(itemUncomplete(args));
  }

  getBody(useSyncToken: boolean): string {
    const body = new URLSearchParams({
      sync_token: useSyncToken ? this.syncToken ?? "*" : "*",
      resource_types: JSON.stringify(["projects", "items"]),
      commands: JSON.stringify(this.commands)
    }).toString();

    return body;
  }

  private syncProjects(projects: ProjectResponse[]) {
    const projectMap: ProjectMap = {};

    for (const project of projects) {
      projectMap[project.id] = project;
    }

    this.syncedProjects = projectMap;
  }

  private syncItems(items: ItemResponse[]) {
    for (const item of items) {
      this.syncedItems[item.id] = {
        id: item.id,
        content: item.content,
        due: item.due,
        priority: item.priority,
        labels: item.labels,
        completed: !!item.completed_at,
        project_id: item.project_id
      };
    }
  }

  private async getDiff(canChange: boolean = false): Promise<ProjectDiffMap> {
    const projectDiff: ProjectDiffMap = {};

    let syncedRegisteredTodos: Record<string, Todo> = {};
    let index = 0;
    for (const [filePath, todos] of Object.entries(
      this.plugin.settings.registeredFiles
    )) {
      if (!(await this.vault.adapter.exists(filePath))) {
        delete this.plugin.settings.registeredFiles[filePath];
        await this.plugin.saveSettings();
      }

      let content = await this.vault.adapter.read(filePath);

      let lines = content.split("\n");
      let body: (string | Todo)[] = [];
      let buffer = "";

      for (let line of lines) {
        let todo = parseTodo(line);

        if (todo) {
          if (buffer) {
            body.push(buffer);
            buffer = "";
          }
          if (todos[todo.id]) {
            todos[todo.id] = todo;
            syncedRegisteredTodos[todo.id] = todo;
            body.push(todo);
          } else {
            buffer += line + "\n";
          }
        } else {
          buffer += line + "\n";
        }
      }

      if (buffer) {
        body.push(buffer);
      }

      projectDiff[index] = {
        name: "Inbox",
        body: body,
        filePath: filePath,
        needsUpdate: false
      };

      index++;
    }

    const { files } = await this.vault.adapter.list(this.directory);

    const syncedProjectsCopy = { ...this.syncedProjects };
    const syncedItemsCopy = { ...this.syncedItems };

    for (const file of files) {
      let needsUpdate = false;
      let fileName = parseFile(file);

      let { name, id: projId } = fileName;

      let content: string;
      if (!(await this.vault.adapter.exists(file))) {
        content = "";
      } else {
        content = await this.vault.adapter.read(file);
      }

      let syncedProj = this.syncedProjects[projId];

      if (!projId || !syncedProj || projectDiff[file]) {
        projId = generateUUID();

        if (canChange) {
          this.projectAdd(
            {
              name: name
            },
            projId
          );
          needsUpdate = true;
        }
      } else {
        if (syncedProj.name !== name) {
          if (canChange) {
            this.projectUpdate({
              id: projId,
              name: name
            });
          } else {
            name = syncedProj.name;
          }

          needsUpdate = true;
        }

        delete syncedProjectsCopy[projId];
      }

      let buffer: string = "";

      const lines = content.split("\n");
      const body: (string | Todo)[] = [];

      let todoDiff: Record<string, boolean> = {};

      for (const line of lines) {
        const todo = parseTodo(line);
        if (todo) {
          if (buffer.length > 0) {
            body.push(buffer);
            buffer = "\n";
          }

          let syncedItem = this.syncedItems[todo.id];

          if (!syncedItem) {
            syncedItem = this.plugin.settings.completedTodos[todo.id];
          }

          if (!todo.id || !syncedItem || todoDiff[todo.id]) {
            todo.id = generateUUID();

            if (canChange)
              this.itemAdd(
                {
                  project_id: projId,
                  content: todo.content,
                  priority: todo.priority,
                  due: todo.due,
                  labels: todo.labels
                },
                todo.id
              );
          } else {
            if (!todo.priority) todo.priority = syncedItem.priority;
            let syncedRegisteredTodo = syncedRegisteredTodos[todo.id];

            let update = getUpdatedItem(syncedItem, todo);

            if (syncedRegisteredTodo) {
              if (!syncedRegisteredTodo.priority)
                syncedRegisteredTodo.priority = syncedItem.priority;

              let registeredTodoUpdate = getUpdatedItem(
                syncedItem,
                syncedRegisteredTodo
              );

              if (Object.keys(registeredTodoUpdate).length > 1) {
                update = registeredTodoUpdate;
              }

              if (syncedRegisteredTodo.completed !== syncedItem.completed) {
                todo.completed = syncedRegisteredTodo.completed;
              }
            }

            if (
              update.content ||
              update.due ||
              update.priority ||
              update.labels
            ) {
              if (canChange) {
                this.itemUpdate(update);
              } else {
                todo.content = syncedItem.content;
                todo.due = syncedItem.due;
                todo.priority = syncedItem.priority;
                todo.labels = syncedItem.labels;
              }
            }

            if (shouldComplete(syncedItem, todo)) {
              if (canChange)
                this.itemComplete({
                  id: todo.id
                });
              else todo.completed = false;
            }

            if (shouldUncomplete(syncedItem, todo)) {
              if (canChange) {
                if (this.plugin.settings.completedTodos[todo.id]) {
                  delete this.plugin.settings.completedTodos[todo.id];

                  await this.plugin.saveSettings();
                }

                this.itemUncomplete({
                  id: todo.id
                });
              } else todo.completed = true;
            }

            delete syncedItemsCopy[todo.id];
          }

          todoDiff[todo.id] = true;

          body.push(todo);
        } else {
          buffer += line + "\n";
        }
      }

      if (buffer.length > 0) {
        body.push(buffer);
      }

      projectDiff[projId] = {
        name: name,
        body: body,
        filePath: file,
        needsUpdate: needsUpdate
      };
    }

    for (const [projId, project] of Object.entries(syncedProjectsCopy)) {
      if (canChange) {
        this.projectDelete({
          id: projId
        });
      } else {
        projectDiff[projId] = {
          name: project.name,
          body: [],
          filePath: "",
          needsUpdate: false
        };
      }
    }

    for (const [itemId, item] of Object.entries(syncedItemsCopy)) {
      if (canChange) {
        this.itemDelete({
          id: itemId
        });
      } else {
        let project = projectDiff[item.project_id];

        if (project) {
          project.body.unshift({
            id: itemId,
            content: item.content,
            completed: item.completed,
            due: item.due,
            priority: item.priority,
            labels: item.labels
          });
        }
      }
    }

    return projectDiff;
  }

  async writeDiff(projectDiffMap: ProjectDiffMap) {
    for (let [projId, project] of Object.entries(projectDiffMap)) {
      let tempIdMapped = this.temp_id_mapping[projId];

      let projPath: string = project.filePath;

      if (tempIdMapped) {
        projId = tempIdMapped;
      }

      if (tempIdMapped || this.syncedProjects[projId]) {
        projPath = this.getFilePath({
          name: project.name,
          id: projId
        });

        if (project.needsUpdate) {
          await this.vault.adapter.rename(project.filePath, projPath);
        }
      }

      this.writeBody(projPath, project.body);
    }
  }

  private async writeBody(projPath: string, body: (string | Todo)[]) {
    await this.vault.adapter.write(projPath, this.getContentOfBody(body));
  }

  private getContentOfBody(body: (string | Todo)[]): string {
    let content = "";

    for (let todo of this.plugin.settings.sortTodos ? sortTodos(body) : body) {
      if (typeof todo === "string") {
        content += todo;
        continue;
      }

      let itemId = todo.id;
      let tempIdMapped = this.temp_id_mapping[itemId];
      todo.id = tempIdMapped ? tempIdMapped : todo.id;
      let syncedTodo = this.syncedItems[todo.id];

      if (syncedTodo) {
        todo = {
          completed: syncedTodo.completed,
          content: syncedTodo.content,
          due: syncedTodo.due,
          id: todo.id,
          priority: syncedTodo.priority,
          labels: syncedTodo.labels
        };
      }

      let id = tempIdMapped ? tempIdMapped : todo.id;
      let due = todo.due ? `(@${todo.due.date})` : "";

      let labels = todo.labels.length ? `#${todo.labels.join(" #")}` : "";
      let postfix = id ? `<!-- ${id} -->` : "";
      let todoContent = this.plugin.settings.allowColor
        ? `<span style="color : ${this.getPriorityColor(todo.priority)}" > ${
            todo.content
          } </span>`
        : todo.content;

      content += `- [${
        todo.completed ? "x" : " "
      }] ${todoContent} ${due} ${labels} ${postfix}\n`;
    }

    return content;
  }

  private async writeRegisteredFilesDiff(
    diff: Record<string, (Todo | string)[]>
  ) {
    for (const [filePath, body] of Object.entries(diff)) {
      await this.vault.adapter.write(filePath, this.getContentOfBody(body));
    }
  }

  private getFilePath(project: { name: string; id: string | null }): string {
    let name = project.name.replace(/[\/\\?%*:|"<>[\]#|^]/g, "-");
    let postfix = project.id ? ` - ${project.id}` : "";
    return `${this.directory}/${name}${postfix}.md`;
  }

  get directory(): string {
    return this.plugin.settings.directory;
  }

  private getPriorityColor = (priority: Priority): string => {
    return this.plugin.settings.priorityColor[5 - priority];
  };

  async pushCodeBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    let sectionInfo = ctx.getSectionInfo(el);
    let filePath = ctx.sourcePath;

    let lines = source.split("\n");
    let buffer = "";

    let body: (string | Todo)[] = [];

    for (let line of lines) {
      let todo = parseTodo(line, true);

      if (todo) {
        if (buffer) {
          body.push(buffer);
          buffer = "";
        }

        todo.id = generateUUID();

        this.itemAdd(
          {
            project_id: this.inbox_id,
            content: todo.content,
            priority: todo.priority,
            due: todo.due,
            labels: todo.labels
          },
          todo.id
        );

        body.push(todo);
      } else {
        buffer += line + "\n";
      }
    }

    if (buffer) {
      body.push(buffer);
    }

    await this.sync();

    const content = this.getContentOfBody(body);

    await this.vault.adapter.write(
      filePath,
      insertTextAtPosition(content, sectionInfo.text, {
        lineStart: sectionInfo.lineStart,
        lineEnd: sectionInfo.lineEnd
      })
    );

    let inboxFilePath = this.getFilePath({
      name: "Inbox",
      id: this.inbox_id
    });

    const inboxText = await this.vault.adapter.read(inboxFilePath);

    let todos: Record<string, Todo> = {};

    const filteredBody: (string | Todo)[] = body.filter((todo) => {
      if (typeof todo === "string") return true;
      if (todo.id) {
        todos[todo.id] = todo;
        return false;
      }
      return true;
    });
    filteredBody.push(inboxText);

    console.log(todos);

    await this.registerFile(filePath, todos);

    await this.writeBody(inboxFilePath, filteredBody);
  }

  private async registerFile(file: string, todos: Record<string, Todo>) {
    this.plugin.settings.registeredFiles[file] = todos;
    await this.plugin.saveSettings();
  }

  private async syncCompletedItems(completed_items: CompletedItemResponse[]) {
    for (const item of completed_items) {
      let todo = item.item_object;
      let todoItem = {
        id: todo.id,
        content: todo.content,
        due: todo.due,
        priority: todo.priority,
        labels: todo.labels,
        completed: true,
        project_id: item.project_id
      };

      this.syncedItems[todo.id] = todoItem;
      this.plugin.settings.completedTodos[todo.id] = todoItem;
    }

    await this.plugin.saveSettings();
  }
}
