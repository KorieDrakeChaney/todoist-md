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
  parseBaseName,
  parseTodo,
  shouldComplete,
  shouldUncomplete,
  sortTodos,
  insertTextAtPosition,
  ignoreCodeBlock,
  compareObjects
} from "./utils";
import { Priority, Project, Todo, TodoBody, TodoItem } from "./types";
import { ChangeLog } from "src/settings";

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
        project_id: item.project_id,
        description: item.description
      };
    }
  }

  private async getDiff({
    isPush,
    canChange
  }: DiffOptions): Promise<ProjectDiffMap> {
    const projectDiff: ProjectDiffMap = {};
    let syncedRegisteredTodos: Record<string, Todo> = {};

    let forcedUpdate = !compareObjects(
      this.plugin.settings.previousEditorSettings,
      {
        showColor: this.plugin.settings.showColor,
        showDescription: this.plugin.settings.showDescription,
        sortTodos: this.plugin.settings.sortTodos,
        priorityColor: this.plugin.settings.priorityColor
      }
    );

    let projectsThatAreForced: Record<string, boolean> = {};

    let index = 0;
    for (const [filePath, todos] of Object.entries(
      this.plugin.settings.registeredFiles
    )) {
      let file = this.vault.getFileByPath(filePath);

      if (!file) {
        delete this.plugin.settings.registeredFiles[filePath];
        continue;
      }

      if (
        isPush &&
        this.plugin.settings.fileLastModifiedTime[filePath] ===
          file.stat.mtime &&
        !forcedUpdate
      ) {
        continue;
      }

      let content = await this.vault.adapter.read(filePath);
      let todoCopy = { ...todos };

      let lines = content.split("\n");
      let body: TodoBody = [];
      let buffer = "";
      let currentTodo: Todo | null = null;

      let pushCurrentTodo = () => {
        if (buffer.length > 0) {
          currentTodo.description = buffer.replaceAll("`", "").trim();
          buffer = "";
        }

        syncedRegisteredTodos[currentTodo.id] = currentTodo;
        projectsThatAreForced[this.syncedItems[currentTodo.id].project_id] =
          true;
        body.push(currentTodo);
        delete todoCopy[currentTodo.id];
        currentTodo = null;
      };

      for (let line of lines) {
        line = line.trim();
        let todo = parseTodo(line);

        if (todo) {
          if (!todo.priority)
            todo.priority = this.plugin.settings.priorityMap[todo.id];

          if (todos[todo.id]) {
            if (currentTodo) pushCurrentTodo();
            else if (buffer) {
              body.push(buffer);
              buffer = "";
            }
            currentTodo = todo;
          } else {
            body.push(line + "\n");
          }
        } else {
          if (line.length == 0) {
            if (currentTodo) {
              pushCurrentTodo();
            }

            continue;
          }
          buffer += line + "\n";
        }
      }

      if (currentTodo) {
        pushCurrentTodo();
      } else if (buffer.length > 0) {
        body.push(buffer);
      }

      for (const [todoId, _] of Object.entries(todoCopy)) {
        delete todos[todoId];
      }

      if (Object.keys(todos).length === 0) {
        delete this.plugin.settings.registeredFiles[filePath];
      }

      projectDiff[index] = {
        name: "Inbox",
        body: body,
        filePath: filePath,
        needsRename: false,
        hasUpdates: true
      };

      index++;
    }

    if (!(await this.vault.adapter.exists(this.directory))) {
      await this.vault.adapter.mkdir(this.directory);
    }

    const files = this.vault.getMarkdownFiles();

    const syncedProjectsCopy = { ...this.syncedProjects };
    const syncedItemsCopy = { ...this.syncedItems };

    for (let file of files) {
      if (!(file.extension === "md") || !file.path.startsWith(this.directory))
        continue;

      let hasUpdates = false;
      let needsRename = false;

      let { name, id: projId } = parseBaseName(file.basename);

      let content = await this.vault.adapter.read(file.path);
      let syncedProj = this.syncedProjects[projId];

      if (
        isPush &&
        this.plugin.settings.fileLastModifiedTime[file.path] ===
          file.stat.mtime &&
        !forcedUpdate &&
        !projectsThatAreForced[projId]
      ) {
        if (syncedProj) {
          for (let id of this.plugin.settings.previousProjects[projId]) {
            delete syncedItemsCopy[id];
          }
          delete syncedProjectsCopy[projId];
        }
        continue;
      }

      if (!projId || !syncedProj || projectDiff[file.path]) {
        hasUpdates = true;
        projId = generateUUID();

        if (isPush) {
          this.projectAdd(
            {
              name: name
            },
            projId
          );
          needsRename = true;
        } else if (canChange) {
          await this.vault.adapter.remove(file.path);
          continue;
        }
      } else {
        if (syncedProj.name !== name) {
          hasUpdates = true;
          if (isPush) {
            this.projectUpdate({
              id: projId,
              name: name
            });
          } else if (canChange) {
            needsRename = true;
          }
        }

        delete syncedProjectsCopy[projId];
      }

      const lines = content.split("\n");
      const body: TodoBody = [];

      let buffer: string = "";
      let todoDiff: Record<string, boolean> = {};
      let currentTodo: Todo | null = null;

      const pushCurrentTodo = () => {
        if (buffer.length > 0) {
          currentTodo.description = buffer.replaceAll("`", "").trim();
          buffer = "";
        }

        if (
          this.getDiffOfTodo(
            currentTodo,
            !!todoDiff[currentTodo.id],
            projId,
            { isPush, canChange },
            syncedRegisteredTodos[currentTodo.id]
          )
        ) {
          console.log(currentTodo);
          console.log("here");
          hasUpdates = true;
        }

        if (
          !isPush &&
          canChange &&
          (!currentTodo.id ||
            !this.syncedItems[currentTodo.id] ||
            todoDiff[currentTodo.id])
        ) {
          hasUpdates = true;
          currentTodo = null;
          return;
        }

        todoDiff[currentTodo.id] = true;
        body.push(currentTodo);
        delete syncedItemsCopy[currentTodo.id];
        currentTodo = null;
      };

      for (const line of lines) {
        const todo = parseTodo(line);
        if (todo) {
          if (currentTodo) pushCurrentTodo();
          else if (buffer) {
            body.push(buffer);
            buffer = "";
          }

          let syncedItem = this.syncedItems[todo.id];

          if (!todo.priority)
            todo.priority = this.plugin.settings.priorityMap[todo.id];

          currentTodo = todo;

          if (syncedItem) {
            delete syncedItemsCopy[todo.id];
          }
        } else {
          if (line.length == 0) {
            if (currentTodo) pushCurrentTodo();
            continue;
          }
          buffer += line + "\n";
        }
      }

      if (currentTodo) {
        pushCurrentTodo();
      } else if (buffer.length > 0) {
        body.push(buffer);
      }

      projectDiff[projId] = {
        name: name,
        body: body,
        filePath: file.path,
        needsRename,
        hasUpdates: forcedUpdate || hasUpdates
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
          needsRename: false,
          hasUpdates: true
        };
      }
    }

    for (const [itemId, item] of Object.entries(syncedItemsCopy)) {
      if (isPush && canChange) {
        this.itemDelete({
          id: itemId
        });
        delete this.plugin.settings.completedTodos[itemId];
        delete this.plugin.settings.priorityMap[itemId];
      } else {
        let project = projectDiff[item.project_id];

        if (project) {
          project.body.unshift({
            id: itemId,
            content: item.content,
            completed: item.completed,
            due: item.due,
            priority: item.priority,
            labels: item.labels,
            description: item.description
          });
          project.hasUpdates = true;
        }
      }
    }

    await this.plugin.saveSettings();

    return projectDiff;
  }

  async writeDiff(projectDiffMap: ProjectDiffMap) {
    for (let [projId, project] of Object.entries(projectDiffMap)) {
      if (!project.hasUpdates) continue;

      this.plugin.settings.previousProjects[projId] = project.body.reduce(
        (acc: string[], todo) => {
          if (typeof todo === "string") return acc;
          acc.push(todo.id);
          return acc;
        },
        [] as string[]
      );

      let tempIdMapped = this.temp_id_mapping[projId];

      let projPath: string = project.filePath;

      if (tempIdMapped) {
        projId = tempIdMapped;
      }

      let syncedProject = this.syncedProjects[projId];

      if (tempIdMapped || syncedProject) {
        if (project.needsRename) {
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

      let mtime = Math.floor(Date.now() / 1000);
      this.plugin.settings.fileLastModifiedTime[projPath] = mtime;
      await this.writeBody(projPath, project.body, mtime);
    }

    this.plugin.settings.previousEditorSettings = {
      showColor: this.plugin.settings.showColor,
      showDescription: this.plugin.settings.showDescription,
      sortTodos: this.plugin.settings.sortTodos,
      priorityColor: {
        1: this.plugin.settings.priorityColor[1],
        2: this.plugin.settings.priorityColor[2],
        3: this.plugin.settings.priorityColor[3],
        4: this.plugin.settings.priorityColor[4]
      }
    };

    await this.plugin.saveSettings();
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

  private async writeBody(projPath: string, body: TodoBody, mtime?: number) {
    await this.vault.adapter.write(
      projPath,
      this.getContentOfBody(body).trimEnd(),
      {
        mtime: mtime ?? Math.floor(Date.now() / 1000)
      }
    );
  }

  private getContentOfBody(body: TodoBody): string {
    let content = "";

    for (let todo of this.plugin.settings.sortTodos ? sortTodos(body) : body) {
      if (typeof todo === "string" || !todo.id) {
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
          labels: syncedTodo.labels,
          description: syncedTodo.description
        };
      }

      let id = tempIdMapped ? tempIdMapped : syncedTodo ? syncedTodo.id : null;
      let due = todo.due ? `(@${todo.due.date})` : "";

      let labels = todo.labels.length ? `#${todo.labels.join(" #")}` : "";
      let postfix = id ? `<!--${id}-->` : "";
      let todoContent = this.plugin.settings.showColor
        ? `<span style="color : ${this.getPriorityColor(todo.priority)}" > ${
            todo.content
          } </span>`
        : todo.content;

      let descriptionBody = todo.description
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => `\t\`${line}\``)
        .join("\n");

      let description =
        todo.description?.length > 0 && this.plugin.settings.showDescription
          ? `\n${descriptionBody}`
          : "";

      if (id) this.plugin.settings.priorityMap[id] = todo.priority;

      content += `- [${
        todo.completed ? "x" : " "
      }] ${todoContent} ${due} ${labels} ${postfix}${description}\n`;
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
    await this.sync();
    let lines = source.split("\n");
    let body: Todo[] = [];
    let filters: string[] = [];

    let hasNewTodos = false;

    let currentProjId: string = this.inbox_id ?? "";

    let currentTodo: Todo | null = null;

    let pushTodo = (todo: Todo) => {
      console.log(currentProjId);
      this.itemAdd(
        {
          project_id: currentProjId,
          content: todo.content,
          priority: todo.priority,
          due: todo.due,
          labels: todo.labels,
          description: todo.description
        },
        todo.id
      );

      body.push(todo);

      currentTodo = null;
    };

    for (let line of lines) {
      line = line.trim();
      let todo = parseTodo(line, true);

      if (todo) {
        hasNewTodos = true;
        todo.id = generateUUID();
        if (currentTodo) pushTodo(currentTodo);
        currentTodo = todo;
      } else {
        if (line.length > 0) {
          if (line.startsWith("@")) {
            if (currentTodo) pushTodo(currentTodo);

            let potentialProj = line.slice(1);
            let projId = this.projectNameToIdMap[potentialProj];
            if (projId) {
              console.log(projId);
              currentProjId = projId;
            } else {
              let found = false;
              for (let [name, id] of Object.entries(this.projectNameToIdMap)) {
                if (name.toLowerCase().includes(potentialProj.toLowerCase())) {
                  currentProjId = id;
                  found = true;
                  break;
                }
              }
              if (!found) {
                currentProjId = generateUUID();
                this.projectAdd(
                  {
                    name: potentialProj
                  },
                  currentProjId
                );
              }
            }

            continue;
          }

          if (line.startsWith(":")) {
            if (currentTodo) {
              currentTodo.description = line.slice(1);
            }
          } else {
            let filter = line;
            if (filter) {
              filters.push(filter);
            }
          }

          if (currentTodo) pushTodo(currentTodo);
        }
      }
    }

    if (currentTodo) pushTodo(currentTodo);

    if (hasNewTodos) await this.softPull();

    let bodyContent = this.getContentOfBody(body);

    let filterTodos: Todo[] = [];

    if (filters.length > 0) {
      new Notice("Fetching items from Todoist...");
      for (let filter of filters) {
        try {
          const items = await this.filter(filter);

          for (let item of items) {
            let todo: TodoItem = {
              id: item.id,
              content: item.content,
              due: item.due,
              priority: item.priority,
              labels: item.labels,
              completed: !!item.completed_at,
              project_id: item.project_id,
              description: item.description
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
          acc[todo.id] = true;
          return acc;
        }, {} as Record<string, boolean>)
      );
    }

    new Notice("Successfully parsed CodeBlock!");
  }

  private getDiffOfTodo(
    todo: Todo,
    isNew: boolean,
    projId: string,
    { isPush, canChange }: DiffOptions,
    syncedRegisteredTodo?: Todo
  ): boolean {
    let syncedItem = this.syncedItems[todo.id];
    let didUpdate = false;
    if (!todo.id || !syncedItem || isNew) {
      if (!todo.priority) todo.priority = 1;
      todo.id = generateUUID();

      if (isPush) {
        didUpdate = true;
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
      }
    } else {
      if (!todo.priority) {
        didUpdate = true;
        todo.priority = syncedItem.priority;
      }
      if (!todo.description && syncedItem.description) {
        didUpdate = true;
        todo.description = syncedItem.description;
      }

      let update = getUpdatedItem(syncedItem, todo);

      if (syncedRegisteredTodo) {
        if (!syncedRegisteredTodo.priority)
          syncedRegisteredTodo.priority = syncedItem.priority;
        if (!syncedRegisteredTodo.description) {
          syncedRegisteredTodo.description = syncedItem.description;
        }

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

        if (syncedRegisteredTodo.description) {
          todo.description = syncedRegisteredTodo.description;
        }
      }

      if (Object.keys(update).length > 1) {
        didUpdate = true;
        if (isPush) {
          this.itemUpdate(update);
        } else if (!canChange) {
          this.syncedItems[todo.id] = {
            ...syncedItem,
            ...update
          };
        }
      }

      if (shouldComplete(syncedItem, todo)) {
        if (isPush) {
          this.plugin.settings.completedTodos[todo.id] = {
            ...todo,
            description: todo.description ?? syncedItem.description,
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
    }

    return didUpdate;
  }

  private async registerFile(file: string, todos: Record<string, boolean>) {
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
      let todoItem: TodoItem = {
        id: todo.id,
        content: todo.content,
        due: todo.due,
        priority: todo.priority,
        labels: todo.labels,
        project_id: todo.project_id,
        description: todo.description,
        completed: true
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
