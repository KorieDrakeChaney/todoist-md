import TodoistMarkdownPlugin from "src/main";
import { obsidianFetch, RequestParams } from "./fetch";
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
import { MarkdownSectionInformation, Notice, Vault } from "obsidian";
import {
  generateUUID,
  getUpdatedItem,
  parseFile,
  parseTodo,
  shouldComplete,
  shouldUncomplete,
  sortTodos,
  insertTextAtPosition,
  ignoreCodeBlock
} from "./utils";
import { Priority, Project, Todo, TodoBody, TodoItem } from "./types";

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

type DiffOptions = {
  canChange: boolean;
  isPush: boolean;
};

export class TodoistAPI {
  private readonly vault: Vault;
  private readonly plugin: TodoistMarkdownPlugin;
  private syncToken: string | null = null;
  private commands: Command<unknown>[] = [];

  private projectNameToIdMap: Record<string, string> = {};
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
  }

  private async syncDiff({ isPush, canChange }: DiffOptions) {
    let diff: ProjectDiffMap;

    new Notice(isPush ? "Pushing to Todoist..." : "Pulling from Todoist...");

    try {
      if (isPush) {
        diff = await this.getDiff({ isPush, canChange });
        await this.sync();
      } else {
        await this.sync();
        diff = await this.getDiff({ isPush, canChange });
      }

      await this.writeDiff(diff);

      new Notice(isPush ? "Pushed to Todoist!" : "Pulled from Todoist!");
    } catch (error: unknown) {
      new Notice(error.toString());
    }

    this.clear();
  }

  async softPull() {
    await this.syncDiff({ isPush: false, canChange: false });
  }

  async forcedPull() {
    await this.syncDiff({ isPush: false, canChange: true });
  }

  async push() {
    await this.syncDiff({ isPush: true, canChange: true });
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

    this.syncedItems = {};

    params.body = new URLSearchParams({
      annotate_items: "true"
    }).toString();

    const completedResponse = await obsidianFetch(params);

    if (completedResponse.status !== 200) {
      throw new Error(
        `Error syncing Todoist projects: ${completedResponse.body}`
      );
    }

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
    const projectNameToIdMap: Record<string, string> = {};

    for (const project of projects) {
      projectMap[project.id] = project;
      projectNameToIdMap[project.name] = project.id;
    }

    this.projectNameToIdMap = projectNameToIdMap;
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

  private async getDiff({
    isPush,
    canChange
  }: DiffOptions): Promise<ProjectDiffMap> {
    const projectDiff: ProjectDiffMap = {};

    let syncedRegisteredTodos: Record<string, Todo> = {};
    let index = 0;
    for (const [filePath, todos] of Object.entries(
      this.plugin.settings.registeredFiles
    )) {
      if (!(await this.vault.adapter.exists(filePath))) {
        delete this.plugin.settings.registeredFiles[filePath];
        continue;
      }

      let content = await this.vault.adapter.read(filePath);
      let todoCopy = { ...todos };

      let lines = content.split("\n");
      let body: TodoBody = [];
      let buffer = "";

      for (let line of lines) {
        let todo = parseTodo(line);

        if (todo) {
          let syncedItem = this.syncedItems[todo.id];

          if (!todo.priority) todo.priority = syncedItem?.priority ?? 1;
          if (buffer) {
            body.push(buffer);
            buffer = "";
          }
          if (todos[todo.id]) {
            todos[todo.id] = todo;
            syncedRegisteredTodos[todo.id] = todo;
            body.push(todo);
            delete todoCopy[todo.id];
          } else {
            buffer += line + "\n";
          }
        } else {
          buffer += line + "\n";
        }
      }

      for (const [todoId, _] of Object.entries(todoCopy)) {
        delete todos[todoId];
      }

      if (Object.keys(todos).length === 0) {
        delete this.plugin.settings.registeredFiles[filePath];
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

    if (!(await this.vault.adapter.exists(this.directory))) {
      await this.vault.adapter.mkdir(this.directory);
    }

    const { files } = await this.vault.adapter.list(this.directory);

    const syncedProjectsCopy = { ...this.syncedProjects };
    const syncedItemsCopy = { ...this.syncedItems };

    for (let file of files) {
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

        if (isPush) {
          this.projectAdd(
            {
              name: name
            },
            projId
          );
          needsUpdate = true;
        } else if (canChange) {
          await this.vault.adapter.remove(file);
          continue;
        }
      } else {
        if (syncedProj.name !== name) {
          if (isPush) {
            this.projectUpdate({
              id: projId,
              name: name
            });
          } else if (canChange) {
            needsUpdate = true;
          }
        }

        delete syncedProjectsCopy[projId];
      }

      const lines = content.split("\n");
      const body: TodoBody = [];

      let buffer: string = "";
      let todoDiff: Record<string, boolean> = {};

      for (const line of lines) {
        const todo = parseTodo(line);
        if (todo) {
          if (buffer.length > 0) {
            body.push(buffer);
            buffer = "";
          }

          let syncedItem = this.syncedItems[todo.id];

          if (!todo.id || !syncedItem || todoDiff[todo.id]) {
            if (!todo.priority) todo.priority = 1;
            todo.id = generateUUID();

            if (isPush)
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
            else if (canChange) {
              continue;
            }
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
              if (isPush) {
                this.itemUpdate(update);
              } else if (canChange) {
                todo.content = syncedItem.content;
                todo.due = syncedItem.due;
                todo.priority = syncedItem.priority;
                todo.labels = syncedItem.labels;
              }
            }

            if (shouldComplete(syncedItem, todo)) {
              if (isPush) {
                this.plugin.settings.completedTodos[todo.id] = {
                  ...todo,
                  project_id: projId
                };
                this.itemComplete({
                  id: todo.id
                });
              } else if (canChange) todo.completed = false;
            }

            if (shouldUncomplete(syncedItem, todo)) {
              if (isPush) {
                if (this.plugin.settings.completedTodos[todo.id]) {
                  delete this.plugin.settings.completedTodos[todo.id];
                }

                this.itemUncomplete({
                  id: todo.id
                });
              } else if (canChange) todo.completed = true;
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
      if (isPush && canChange) {
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
      if (isPush && canChange) {
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

    await this.plugin.saveSettings();

    return projectDiff;
  }

  async writeDiff(projectDiffMap: ProjectDiffMap) {
    for (let [projId, project] of Object.entries(projectDiffMap)) {
      let tempIdMapped = this.temp_id_mapping[projId];

      let projPath: string = project.filePath;

      if (tempIdMapped) {
        projId = tempIdMapped;
      }

      let syncedProject = this.syncedProjects[projId];

      if (tempIdMapped || syncedProject) {
        if (project.needsUpdate) {
          projPath = this.getFilePath({
            name: syncedProject.name,
            id: projId
          });
          await this.vault.adapter.rename(project.filePath, projPath);
        } else {
          projPath = this.getFilePath({
            name: project.name,
            id: projId
          });
        }
      }

      this.writeBody(projPath, project.body);
    }
  }

  async filter(filter: string): Promise<ItemResponse[]> {
    const encodedFilter = encodeURIComponent(filter);
    const params: RequestParams = {
      url: `${restUrl}/tasks?filter=${encodedFilter}`,
      headers: {
        Authorization: `Bearer ${this.plugin.settings.token}`
      },
      method: "GET"
    };

    const response = await obsidianFetch(params);

    if (response.status !== 200) {
      throw new Error(`Error fetching filter: ${response.body}`);
    }

    return parseResponse<ItemResponse[]>(response.body);
  }

  private async writeBody(projPath: string, body: TodoBody) {
    await this.vault.adapter.write(
      projPath,
      this.getContentOfBody(body).trimEnd()
    );
  }

  private getContentOfBody(body: TodoBody): string {
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

      let id = tempIdMapped ? tempIdMapped : syncedTodo ? syncedTodo.id : null;
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
    sectionInfo: MarkdownSectionInformation,
    sourcePath: string
  ): Promise<void> {
    let lines = source.split("\n");
    let body: Todo[] = [];
    let filters: string[] = [];

    let hasNewTodos = false;

    let currentProjId: string = this.inbox_id ?? "";

    for (let line of lines) {
      line = line.trim();
      let todo = parseTodo(line, true);

      if (todo) {
        hasNewTodos = true;
        todo.id = generateUUID();

        this.itemAdd(
          {
            project_id: currentProjId,
            content: todo.content,
            priority: todo.priority,
            due: todo.due,
            labels: todo.labels
          },
          todo.id
        );

        body.push(todo);
      } else {
        if (line.length > 0) {
          if (line.startsWith("@")) {
            let potentialProj = line.slice(1);
            let projId = this.projectNameToIdMap[potentialProj];
            console.log(projId);
            if (projId) {
              currentProjId = projId;
            }
            continue;
          }
          let filter = line;
          if (filter) {
            filters.push(filter);
          }
        }
      }
    }

    if (hasNewTodos) await this.softPull();

    let bodyContent = this.getContentOfBody(body);

    let filterTodos: Todo[] = [];

    if (filters.length > 0) {
      new Notice("Fetching items from Todoist...");
      for (let filter of filters) {
        try {
          const items = await this.filter(filter);

          for (let item of items) {
            let todo = {
              id: item.id,
              content: item.content,
              due: item.due,
              priority: item.priority,
              labels: item.labels,
              completed: !!item.completed_at,
              project_id: item.project_id
            };

            filterTodos.push(todo);
          }
        } catch (error: unknown) {
          new Notice(error.toString());
        }
      }
    }

    const filterContent = this.getContentOfBody(filterTodos);

    await this.vault.adapter.write(
      sourcePath,
      insertTextAtPosition(
        bodyContent + filterContent,
        ignoreCodeBlock(sectionInfo.text),
        {
          lineStart: sectionInfo.lineStart,
          lineEnd: sectionInfo.lineEnd
        }
      ).trimEnd()
    );

    body = body.concat(filterTodos);

    if (body.length > 0) {
      this.registerFile(
        sourcePath,
        body.reduce((acc, todo) => {
          acc[todo.id] = todo;
          return acc;
        }, {} as Record<string, Todo>)
      );
    }

    new Notice("Successfully parsed CodeBlock!");
  }

  private async registerFile(file: string, todos: Record<string, Todo>) {
    let registeredFile = this.plugin.settings.registeredFiles[file];

    if (registeredFile)
      this.plugin.settings.registeredFiles[file] = {
        ...registeredFile,
        ...todos
      };
    else this.plugin.settings.registeredFiles[file] = todos;

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

      this.plugin.settings.completedTodos[todo.id] = todoItem;
    }

    this.syncedItems = {
      ...this.syncedItems,
      ...this.plugin.settings.completedTodos
    };

    await this.plugin.saveSettings();
  }
}
