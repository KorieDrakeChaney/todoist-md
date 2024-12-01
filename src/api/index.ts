import TodoistMarkdownPlugin from "src/main";
import { obsidianFetch, RequestParams } from "./fetch";
import {
  CompletedItemResponse,
  Filter,
  ItemResponse,
  LabelResponse,
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
  sortTodoBody,
  compareObjects,
  getmtime,
  sortTodos,
  insertBodyAtPosition,
  getDueState,
  getDueSpan,
  getDay,
  batchArray,
  getDueDate
} from "../utils";
import { Priority, Project, Todo, TodoBody } from "./types";

type TodoistSyncResponse = {
  sync_token: string;
  projects?: ProjectResponse[];
  items?: ItemResponse[];
  sections?: SectionResponse[];
  labels?: LabelResponse[];
  filters?: Filter[];
  temp_id_mapping: Record<string, string>;
};

type TodoistCompletedResponse = {
  items: CompletedItemResponse[];
};

type ItemMap = Record<string, Todo>;
type ProjectMap = Record<string, ProjectResponse>;

type ProjectDiffMap = Record<string, Project>;

type DiffOptions = {
  canChange: boolean;
  isPush: boolean;
};

export class TodoistAPI {
  private readonly plugin: TodoistMarkdownPlugin;
  private commands: Command<unknown>[] = [];

  private projectNameToIdMap: Record<string, string> = {};
  private syncedProjects: ProjectMap = {};
  private syncedItems: ItemMap = {};

  private temp_id_mapping: Record<string, string> = {};
  private temp_id_completed_todos: Record<string, boolean> = {};

  private inbox_id: string | null = null;

  private current_sync_token: string | null = null;

  constructor(plugin: TodoistMarkdownPlugin) {
    this.plugin = plugin;
  }

  private clear() {
    this.commands = [];
    this.temp_id_completed_todos = {};
  }

  private async syncDiff({ isPush, canChange }: DiffOptions) {
    let diff: ProjectDiffMap;

    new Notice(isPush ? "Pushing to Todoist..." : "Pulling from Todoist...");

    try {
      if (isPush) {
        diff = await this.getDiff({ isPush, canChange });
        const limit = 100;
        if (this.commands.length >= limit) {
          for (const batch of batchArray(this.commands, limit)) {
            this.commands = batch;
            await this.sync(false, true);
          }
        } else {
          await this.sync(false);
        }
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

  async sync(
    needsComplete = true,
    incrementalSync: boolean = false
  ): Promise<TodoistSyncResponse> {
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

    const completedResponse = needsComplete
      ? await obsidianFetch(params)
      : null;

    params.url = syncUrl;
    params.body = this.getBody(
      incrementalSync ? this.current_sync_token ?? "*" : "*"
    );
    const response = await obsidianFetch(params);

    if (response.status !== 200) {
      throw new Error(`Error syncing Todoist projects: ${response.body}`);
    }

    const data = parseResponse<TodoistSyncResponse>(response.body);

    this.current_sync_token = data.sync_token;

    for (const project of data.projects ?? []) {
      if (project.inbox_project) this.inbox_id = project.id;
    }

    if (data.projects) this.syncProjects(data.projects, incrementalSync);
    if (data.items) this.syncItems(data.items);

    const completedData =
      completedResponse?.status === 200
        ? parseResponse<TodoistCompletedResponse>(completedResponse.body)
        : { items: [] };

    await this.syncCompletedItems(completedData.items);

    this.temp_id_mapping = incrementalSync
      ? Object.assign(this.temp_id_mapping, data.temp_id_mapping)
      : data.temp_id_mapping;

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

  getBody(syncToken: string): string {
    const body = new URLSearchParams({
      sync_token: syncToken,
      resource_types: JSON.stringify(["projects", "items", "notes"]),
      commands: JSON.stringify(this.commands)
    }).toString();

    return body;
  }

  private syncProjects(projects: ProjectResponse[], incrementalSync = false) {
    const projectMap: ProjectMap = {};
    const projectNameToIdMap: Record<string, string> = {};

    for (const project of projects) {
      projectMap[project.id] = project;
      projectNameToIdMap[project.name] = project.id;
    }

    this.projectNameToIdMap = incrementalSync
      ? Object.assign(projectNameToIdMap, this.projectNameToIdMap)
      : projectNameToIdMap;
    this.syncedProjects = incrementalSync
      ? Object.assign(projectMap, this.syncedProjects)
      : projectMap;
  }

  private syncItems(items: ItemResponse[], incrementalSync = false) {
    const itemMap: ItemMap = {};

    for (const item of items) {
      itemMap[item.id] = {
        id: item.id,
        content: item.content,
        due: item.due,
        priority: item.priority,
        labels: item.labels,
        completed: !!item.completed_at,
        project_id: item.project_id,
        description: item.description,
        mtime: 0
      };
    }

    this.syncedItems = incrementalSync
      ? Object.assign(itemMap, this.syncedItems)
      : itemMap;
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
        showDueColor: this.plugin.settings.showDueColor,
        showTaskColor: this.plugin.settings.showTaskColor,
        showDescription: this.plugin.settings.showDescription,
        todosOnTop: this.plugin.settings.todosOnTop,
        sortDate: this.plugin.settings.sortDate,
        priorityColor: this.plugin.settings.priorityColor,
        dueColor: this.plugin.settings.dueColor,
        useDatesOnly: this.plugin.settings.useDatesOnly
      }
    );

    let projectsThatAreForced: Record<string, boolean> = {};

    let index = 0;
    let registeredFilesLinked: Record<string, number[]> = {};
    for (const [filePath, _] of Object.entries(
      this.plugin.settings.registeredFiles
    )) {
      let file = this.vault.getFileByPath(filePath);

      if (!file) {
        delete this.plugin.settings.registeredFiles[filePath];
        continue;
      }

      let currProjmtime = file.stat.mtime;

      let content = await this.vault.adapter.read(filePath);

      let lines = content.split("\n");
      let body: TodoBody = [];
      let buffer = "";
      let currentTodo: Todo | null = null;
      let hasTodos = false;

      let pushCurrentTodo = () => {
        if (buffer.length > 0) {
          currentTodo.description = buffer
            .replace(/`/g, "")
            .split("\n")
            .map((line) => line.trim())
            .join("\n");

          buffer = "";
        }

        let syncedRegisteredTodo = syncedRegisteredTodos[currentTodo.id];

        if (
          !syncedRegisteredTodo ||
          currentTodo.mtime > syncedRegisteredTodo.mtime
        ) {
          syncedRegisteredTodos[currentTodo.id] = currentTodo;
          syncedRegisteredTodo = currentTodo;
        }

        let syncedItem = this.syncedItems[currentTodo.id];

        if (syncedItem) {
          hasTodos = true;
          if (
            Object.keys(getUpdatedItem(syncedRegisteredTodo, syncedItem))
              .length > 1 ||
            syncedRegisteredTodo.completed !== syncedItem.completed
          ) {
            projectsThatAreForced[syncedItem.project_id] = true;
          }
          if (!registeredFilesLinked[syncedItem.id]) {
            registeredFilesLinked[syncedItem.id] = [];
          }

          registeredFilesLinked[syncedItem.id].push(index);
          currentTodo.project_id = syncedItem.project_id;
        }

        body.push(currentTodo);
        currentTodo = null;
      };

      for (let line of lines) {
        let todo = parseTodo(line, "", currProjmtime);

        if (todo) {
          if (!todo.priority)
            todo.priority = this.plugin.settings.priorityMap[todo.id];

          if (currentTodo) pushCurrentTodo();
          currentTodo = todo;
        } else {
          if (!line.startsWith("\t") && !line.startsWith("    ")) {
            if (currentTodo) {
              pushCurrentTodo();
            }
            body.push(line + "\n");
          } else {
            if (currentTodo) {
              buffer += buffer.length > 0 ? "\n" + line : line;
            } else {
              body.push(line + "\n");
            }
          }
        }
      }

      if (currentTodo) {
        pushCurrentTodo();
      } else if (buffer.length > 0) {
        body.push(buffer);
      }

      if (!hasTodos) {
        delete this.plugin.settings.registeredFiles[filePath];
        continue;
      }

      projectDiff[index] = {
        name: "Inbox",
        body: body,
        filePath: filePath,
        needsRename: false,
        hasUpdates: forcedUpdate || !isPush
      };

      index++;
    }

    const syncedProjectsCopy = { ...this.syncedProjects };
    const syncedItemsCopy = { ...this.syncedItems };

    try {
      await this.vault.createFolder(this.directory);
    } catch (_) {
      let { files } = await this.vault.adapter.list(this.directory);
      for (let path of files) {
        if (!path.endsWith(".md")) continue;

        let hasUpdates = false;
        let needsRename = false;

        let basename = path.split("/").pop().slice(0, -3);

        let { name, id: projId } = parseBaseName(basename);

        let content = await this.vault.adapter.read(path);
        let syncedProj = this.syncedProjects[projId];

        let projmtime = this.plugin.settings.fileLastModifiedTime[path];

        const stat = await this.vault.adapter.stat(path);

        if (
          isPush &&
          projmtime === stat.mtime &&
          !forcedUpdate &&
          !projectsThatAreForced[projId]
        ) {
          if (syncedProj) {
            for (let id of this.plugin.settings.previousProjects[projId]) {
              if (registeredFilesLinked[id]) {
                for (let index of registeredFilesLinked[id]) {
                  projectDiff[index].hasUpdates = true;
                }
              }
              delete syncedItemsCopy[id];
            }
            delete syncedProjectsCopy[projId];
            delete this.plugin.settings.previousProjects[projId];
          }
          continue;
        }

        if (!projId || !syncedProj || projectDiff[path]) {
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
            await this.vault.adapter.remove(path);
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
            currentTodo.description = buffer
              .replace(/`/g, "")
              .split("\n")
              .map((line) => line.trim())
              .join("\n");

            buffer = "";
          }

          let syncedItem = this.syncedItems[currentTodo.id];

          if (!this.plugin.settings.showDescription && syncedItem)
            currentTodo.description = syncedItem.description;

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

          body.push(currentTodo);

          if (
            this.getDiffOfTodo(
              currentTodo,
              !!todoDiff[currentTodo.id],
              { isPush, canChange },
              syncedRegisteredTodos[currentTodo.id]
            )
          ) {
            if (registeredFilesLinked[currentTodo.id]) {
              for (let index of registeredFilesLinked[currentTodo.id]) {
                projectDiff[index].hasUpdates = true;
              }
            }
            hasUpdates = true;
          }

          todoDiff[currentTodo.id] = true;
          delete syncedItemsCopy[currentTodo.id];
          currentTodo = null;
        };

        for (const line of lines) {
          const todo = parseTodo(line, projId, projmtime);
          if (todo) {
            if (currentTodo) pushCurrentTodo();

            if (!todo.priority)
              todo.priority = this.plugin.settings.priorityMap[todo.id];

            currentTodo = todo;
          } else {
            if (!line.startsWith("\t") && !line.startsWith("    ")) {
              if (currentTodo) {
                pushCurrentTodo();
              }
              body.push(line + "\n");
            } else {
              if (currentTodo) {
                buffer += buffer.length > 0 ? "\n" + line : line;
              } else {
                body.push(line + "\n");
              }
            }
          }
        }

        if (currentTodo) {
          pushCurrentTodo();
        } else if (buffer.length > 0) {
          body.push(buffer);
        }

        if (!hasUpdates && !forcedUpdate) {
          let currentPriority: number | null = null;
          let completedScope = false;
          for (let i = 0; i < body.length; i++) {
            let todo = body[i];
            if (typeof todo === "string") {
              currentPriority = null;
              continue;
            }

            if (i != body.length - 1) {
              let next = body[i + 1];
              if (typeof next === "string") {
                currentPriority = null;
                completedScope = false;
                continue;
              }

              if (currentPriority === null) {
                currentPriority = todo.priority;
              }

              if (todo.completed && !completedScope) {
                completedScope = true;
                currentPriority = todo.priority;
              } else if (!todo.completed) {
                if (completedScope) {
                  hasUpdates = true;
                  break;
                } else if (next.completed) {
                  continue;
                }
              }

              if (currentPriority < next.priority) {
                hasUpdates = true;
                break;
              } else {
                currentPriority = next.priority;
              }
            }
          }
        }

        projectDiff[projId] = {
          name: name,
          body: body,
          filePath: path,
          needsRename,
          hasUpdates: forcedUpdate || hasUpdates || !isPush
        };
      }
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
        if (registeredFilesLinked[itemId]) {
          for (let index of registeredFilesLinked[itemId]) {
            projectDiff[index].hasUpdates = true;
          }
        }
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
            description: item.description,
            mtime:
              this.plugin.settings.fileLastModifiedTime[project.filePath] ??
              Date.now() / 1000,
            project_id: item.project_id
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

      await this.writeBody(projPath, project.body);

      if (tempIdMapped || syncedProject) {
        this.plugin.settings.previousProjects[projId] = project.body.reduce(
          (acc: string[], todo) => {
            if (typeof todo === "string") return acc;

            let itemId = todo.id;
            let tempIdMapped = this.temp_id_mapping[itemId];
            todo.id = tempIdMapped ? tempIdMapped : todo.id;
            let syncedItem = this.syncedItems[todo.id];

            if (syncedItem) {
              acc.push(todo.id);
            }

            return acc;
          },
          [] as string[]
        );
      }
    }

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

  private async writeBody(projPath: string, body: TodoBody) {
    let mtime = getmtime();
    this.plugin.settings.fileLastModifiedTime[projPath] = mtime;
    await this.vault.adapter.write(
      projPath,
      this.getContentOfBody(body).trimEnd(),
      {
        mtime
      }
    );
  }

  private getContentOfBody(body: TodoBody): string {
    let content = "";
    const date = new Date();
    const currentDate = new Date(
      `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
    );

    body = body.map((todo) => {
      if (typeof todo === "string") return todo;
      let prevId = todo.id;
      let itemId = todo.id;
      let tempIdMapped = this.temp_id_mapping[itemId];

      todo.id = tempIdMapped ? tempIdMapped : todo.id;

      let syncedItem = this.syncedItems[todo.id];

      if (this.temp_id_completed_todos[prevId]) {
        this.plugin.settings.completedTodos[todo.id] = todo;
      }

      if (syncedItem) return syncedItem;
      else if (tempIdMapped) return todo;

      todo.id = null;

      return todo;
    });

    for (let todo of this.plugin.settings.todosOnTop
      ? sortTodos(body, this.plugin.settings.sortDate)
      : sortTodoBody(body, this.plugin.settings.sortDate)) {
      if (typeof todo === "string") {
        content += todo;
        continue;
      }

      let due = "";

      if (todo.due) {
        const todoDueDate = new Date(todo.due.date.replaceAll("-", "/"));
        const dueState = getDueState(currentDate, todoDueDate);
        const showColor = this.plugin.settings.showDueColor;
        switch (dueState) {
          case "today": {
            const date = this.plugin.settings.useDatesOnly
              ? todo.due.date
              : "Today";
            due = showColor
              ? getDueSpan(date, this.plugin.settings.dueColor.today)
              : `(@${date})`;
            break;
          }
          case "tomorrow": {
            const date = this.plugin.settings.useDatesOnly
              ? todo.due.date
              : "Tomorrow";
            due = showColor
              ? getDueSpan(date, this.plugin.settings.dueColor.tomorrow)
              : `(@${date})`;
            break;
          }
          case "within_week":
            const date = this.plugin.settings.useDatesOnly
              ? todo.due.date
              : getDay(todoDueDate);
            due = showColor
              ? getDueSpan(date, this.plugin.settings.dueColor.within_week)
              : `(@${date})`;
            break;
          case "future":
          case "past":
            due = showColor
              ? getDueSpan(
                  todo.due.date,
                  this.plugin.settings.dueColor[dueState]
                )
              : `(@${todo.due.date})`;
            break;
        }
      }

      let labels = todo.labels.length ? `#${todo.labels.join(" #")}` : "";
      let postfix = todo.id ? `<!--${todo.id}-->` : "";
      let todoContent =
        this.plugin.settings.showTaskColor && todo.id
          ? `<span style="color:${this.getPriorityColor(todo.priority)}"> ${
              todo.content
            } </span>`
          : todo.content;

      let description =
        todo.description?.length > 0 && this.plugin.settings.showDescription
          ? todo.description
              .split("\n")
              .filter((line) => line.length > 0)
              .map((line) => `\t\`${line}\``)
              .join("\n")
          : "";

      if (todo.id) this.plugin.settings.priorityMap[todo.id] = todo.priority;

      content += `- [${
        todo.completed ? "x" : " "
      }] ${todoContent} ${due} ${labels} ${postfix}${
        description.length > 0 && this.plugin.settings.showDescription
          ? `\n${description}`
          : ""
      }\n`;
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

  get vault(): Vault {
    return this.plugin.app.vault;
  }

  private getPriorityColor = (priority: Priority): string => {
    return this.plugin.settings.priorityColor[5 - priority];
  };

  async pushCodeBlock(
    sectionInfo: MarkdownSectionInformation,
    sourcePath: string
  ): Promise<void> {
    await this.sync();

    let lines = sectionInfo.text.trimEnd().split("\n");

    let body: TodoBody = [];

    let newTodos: Todo[] = [];
    let filters: string[] = [];

    let state: "CODE_BLOCK" | "TEXT" = "TEXT";

    let hasNewTodos = false;

    let currentProjId: string = this.inbox_id ?? "";

    let currentTodo: Todo | null = null;

    let buffer = "";

    let pushTodo = () => {
      if (!currentTodo) return;

      if (buffer.length > 0) {
        currentTodo.description = buffer
          .replace(/`/g, "")
          .split("\n")
          .map((line) => line.trim())
          .join("\n");

        buffer = "";
      }
      if (state === "CODE_BLOCK") {
        this.itemAdd(
          {
            project_id: currentProjId,
            content: currentTodo.content,
            priority: currentTodo.priority,
            due: currentTodo.due,
            labels: currentTodo.labels,
            description: currentTodo.description
          },
          currentTodo.id
        );
      }

      if (state === "CODE_BLOCK") {
        newTodos.push(currentTodo);
      } else {
        body.push(currentTodo);
      }

      currentTodo = null;
    };

    for (let cursor = 0; cursor < lines.length; cursor++) {
      let line = lines[cursor];

      if (line.startsWith("```todomd")) {
        if (state === "CODE_BLOCK") {
          pushTodo();
          if (cursor < lines.length - 1 && lines[cursor + 1].length == 0)
            cursor++;
          state = "TEXT";
        } else {
          state = "CODE_BLOCK";
        }
        continue;
      } else if (state === "CODE_BLOCK" && line.startsWith("```")) {
        pushTodo();
        if (cursor < lines.length - 1 && lines[cursor + 1].length == 0)
          cursor++;
        state = "TEXT";
        continue;
      }

      switch (state) {
        case "TEXT": {
          let todo = parseTodo(line, "", 0);

          if (todo) {
            pushTodo();
            currentTodo = todo;
          } else {
            if (!line.startsWith("\t") && !line.startsWith("    ")) {
              pushTodo();
              body.push(line + "\n");
            } else {
              buffer += buffer.length > 0 ? "\n" + line : line;
            }
          }
          break;
        }
        case "CODE_BLOCK": {
          line = line.trim();
          let todo = parseTodo(line, currentProjId, 0, true);

          if (todo) {
            hasNewTodos = true;
            todo.id = generateUUID();
            pushTodo();
            currentTodo = todo;
          } else {
            if (line.length > 0) {
              if (line.startsWith("@")) {
                pushTodo();

                let potentialProj = line.slice(1);
                let projId = this.projectNameToIdMap[potentialProj];
                if (projId) {
                  currentProjId = projId;
                } else {
                  let found = false;
                  for (let [name, id] of Object.entries(
                    this.projectNameToIdMap
                  )) {
                    if (
                      name.toLowerCase().includes(potentialProj.toLowerCase())
                    ) {
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
              } else if (!line.startsWith("! ")) {
                pushTodo();
                if (line) filters.push(line);
              } else {
                if (currentTodo) {
                  buffer += line.slice(2) + "\n";
                }
              }
            }
          }
        }
      }
    }

    pushTodo();

    if (hasNewTodos) await this.softPull();

    let filterTodos: Todo[] = [];

    if (filters.length > 0) {
      new Notice("Fetching items from Todoist...");
      for (let filter of filters) {
        try {
          const items = await this.filter(filter);

          for (let item of items) {
            let todo: Todo = {
              id: item.id,
              content: item.content,
              due: item.due,
              priority: item.priority,
              labels: item.labels,
              completed: !!item.completed_at,
              project_id: item.project_id,
              description: item.description,
              mtime: 0
            };

            filterTodos.push(todo);
          }
        } catch (error: unknown) {
          new Notice(error.toString());
        }
      }
    }

    newTodos.push(...filterTodos);

    body = insertBodyAtPosition(body, newTodos, sectionInfo.lineStart);

    await this.writeBody(sourcePath, body);

    if (body.length > 0) {
      this.registerFile(sourcePath);
    }

    new Notice("Successfully parsed CodeBlock!");
  }

  private getDiffOfTodo(
    todo: Todo,
    isNew: boolean,
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
            project_id: todo.project_id,
            content: todo.content,
            priority: todo.priority,
            due: todo.due,
            labels: todo.labels,
            description: todo.description
          },
          todo.id
        );

        if (todo.completed) {
          this.itemComplete({
            id: todo.id
          });

          this.temp_id_completed_todos[todo.id] = true;
        }
      }
    } else {
      if (!todo.priority) {
        didUpdate = true;
        todo.priority = syncedItem.priority;
      }
      if (!todo.description && syncedItem.description && !isPush) {
        didUpdate = true;
        todo.description = syncedItem.description;
      }

      let update = getUpdatedItem(syncedItem, todo);

      if (syncedRegisteredTodo) {
        if (!syncedRegisteredTodo.priority)
          syncedRegisteredTodo.priority = syncedItem.priority;
        if (!syncedRegisteredTodo.description && !isPush) {
          syncedRegisteredTodo.description = syncedItem.description;
        }

        let registeredTodoUpdate = getUpdatedItem(
          syncedItem,
          syncedRegisteredTodo
        );

        if (syncedRegisteredTodo.mtime > todo.mtime) {
          if (Object.keys(registeredTodoUpdate).length > 1) {
            update = registeredTodoUpdate;
          }
          todo.completed = syncedRegisteredTodo.completed;
          todo.description = syncedRegisteredTodo.description;
        }
      }

      let hasUpdates = Object.keys(update).length > 1;

      if (
        todo.completed &&
        this.plugin.settings.completedTodos[todo.id] &&
        hasUpdates
      ) {
        new Notice("Completed todos cannot be updated");
        return true;
      }

      if (hasUpdates) {
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
        didUpdate = true;
        if (isPush) {
          this.plugin.settings.completedTodos[todo.id] = todo;
          this.itemComplete({
            id: todo.id
          });
        } else if (canChange) todo.completed = false;
      } else if (shouldUncomplete(syncedItem, todo)) {
        didUpdate = true;
        if (isPush) {
          this.plugin.settings.completedTodos[todo.id] = todo;
          this.itemUncomplete({
            id: todo.id
          });
        } else if (canChange) todo.completed = true;
      }
    }

    return didUpdate;
  }

  private async registerFile(file: string) {
    this.plugin.settings.registeredFiles[file] = true;

    await this.plugin.saveSettings();
  }

  private async syncCompletedItems(completed_items: CompletedItemResponse[]) {
    for (const item of completed_items) {
      let todo = item.item_object;
      let todoItem: Todo = {
        id: todo.id,
        content: todo.content,
        due: todo.due,
        priority: todo.priority,
        labels: todo.labels,
        project_id: todo.project_id,
        description: todo.description,
        completed: true,
        mtime: 0
      };

      this.plugin.settings.completedTodos[todo.id] = todoItem;
    }

    this.syncedItems = {
      ...this.plugin.settings.completedTodos,
      ...this.syncedItems
    };

    await this.plugin.saveSettings();
  }

  async updateOverdueForFile(filePath: string) {
    new Notice("Updating overdue items...");
    await this.sync();

    let file = this.vault.getFileByPath(filePath);

    if (!file) return;

    let content = await this.vault.adapter.read(filePath);

    let lines = content.split("\n");

    let body: TodoBody = [];

    let currentTodo: Todo | null = null;
    let buffer = "";

    const dueObj = new Date();
    const dueString = `${dueObj.getFullYear()}-${
      dueObj.getMonth() + 1
    }-${dueObj.getDate()}`;
    const object = getDueDate(dueString);

    const pushCurrentTodo = () => {
      if (!currentTodo) return;

      let syncedItem = this.syncedItems[currentTodo.id];
      if (!currentTodo.priority)
        currentTodo.priority = syncedItem ? syncedItem.priority : 1;

      if (buffer.length > 0) {
        currentTodo.description = buffer
          .replace(/`/g, "")
          .split("\n")
          .map((line) => line.trim())
          .join("\n");

        buffer = "";
      }

      if (currentTodo.due || (syncedItem && syncedItem.due)) {
        if (!syncedItem || !syncedItem.completed) {
          currentTodo.due = object;
        }

        if (syncedItem) {
          this.itemUpdate({
            id: currentTodo.id,
            due: object
          });
        }
      }

      body.push(currentTodo);

      currentTodo = null;
    };

    for (let line of lines) {
      let todo = parseTodo(
        line,
        this.inbox_id ?? "",
        this.plugin.settings.fileLastModifiedTime[filePath]
      );

      if (todo) {
        pushCurrentTodo();

        currentTodo = todo;
      } else {
        if (!line.startsWith("\t") && !line.startsWith("    ")) {
          if (currentTodo) {
            pushCurrentTodo();
          }
          body.push(line + "\n");
        } else {
          if (currentTodo) {
            buffer += buffer.length > 0 ? "\n" + line : line;
          } else {
            body.push(line + "\n");
          }
        }
      }
    }

    if (currentTodo) {
      pushCurrentTodo();
    } else if (buffer.length > 0) {
      body.push(buffer);
    }

    await this.sync();
    await this.writeBody(filePath, body);

    new Notice("Successfully updated overdue items!");
  }
}
