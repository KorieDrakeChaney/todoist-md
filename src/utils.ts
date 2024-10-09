import type { ItemUpdateArgs } from "./api/arguments";
import type { DueDate, Note, Priority, Todo, TodoBody } from "./api/types";
import { v4 as uuidv4 } from "uuid";

type IdParseState =
  | "BEFORE_ID"
  | "ID"
  | "AFTER_ID"
  | "LESS_THAN"
  | "EXCLAMATION"
  | "DASH"
  | "ID_END";

const parseId = (line: string): { body: string; id: string } => {
  let body = "";
  let id = "";
  let cursor = 0;
  let state: IdParseState = "BEFORE_ID";
  while (cursor < line.length) {
    switch (state) {
      case "BEFORE_ID":
        if (line[cursor] === "<") {
          state = "LESS_THAN";
        } else {
          body += line[cursor];
        }
        break;
      case "LESS_THAN":
        if (line[cursor] === "!") {
          state = "EXCLAMATION";
        } else {
          state = "BEFORE_ID";
          body += "<";
        }
        break;
      case "EXCLAMATION":
        if (line[cursor] === "-") {
          state = "DASH";
        } else {
          state = "BEFORE_ID";
          body += "<!";
        }
        break;
      case "DASH":
        if (line[cursor] === "-") {
          state = "ID";
        } else {
          state = "BEFORE_ID";
          body += "<!-";
        }
        break;
      case "ID":
        if (line[cursor] === "-") {
          state = "ID_END";
        } else {
          id += line[cursor];
        }
        break;
      case "ID_END":
        if (line[cursor] === ">") {
          state = "AFTER_ID";
        } else {
          return { body: line, id: id };
        }
        break;
    }
    cursor++;
  }

  return { body, id };
};

export const parseNote = (line: string, item_id: string): Note => {
  const { body, id } = parseId(line);

  return {
    id: id?.length > 0 ? id : null,
    content: removeHtml(body),
    item_id
  };
};

type TodoParseState =
  | "BEFORE_COMPLETED"
  | "COMPLETED_SPACE"
  | "LEFT_BRACKET"
  | "COMPLETED_CHECK"
  | "RIGHT_BRACKET"
  | "BEFORE_CONTENT"
  | "CONTENT"
  | "LEFT_PARENTHESES"
  | "DUE_DATE"
  | "PRIORITY"
  | "AFTER_PRIORITY"
  | "SPACE"
  | "LABEL"
  | "END";

export const parseTodo = (
  line: string,
  project_id: string = "",
  mtime: number,
  isCodeBlock: boolean = false
): Todo | null => {
  if (line.length === 0) {
    return null;
  }
  let { body, id } = parseId(line);

  body = removeHtml(body);

  if (body.length < 3) return null;

  let state: TodoParseState = "BEFORE_COMPLETED";

  let cursor = 0;

  let completed = false;
  let due: DueDate;
  let content = "";
  let potentialDue = "";
  let priority: Priority;
  let labels: string[] = [];

  let buffer = "";
  while (true) {
    if (cursor >= body.length) {
      break;
    }

    switch (state) {
      case "BEFORE_COMPLETED":
        if (cursor == 0 && body[cursor] == "-") {
          state = "COMPLETED_SPACE";
        } else {
          return null;
        }
        break;
      case "COMPLETED_SPACE":
        if (body[cursor] == " ") {
          if (isCodeBlock) state = "CONTENT";
          else state = "LEFT_BRACKET";
        } else {
          return null;
        }
        break;
      case "LEFT_BRACKET":
        if (body[cursor] == "[") {
          state = "COMPLETED_CHECK";
        } else {
          return null;
        }
        break;
      case "COMPLETED_CHECK":
        switch (body[cursor]) {
          case "x":
            completed = true;
            state = "RIGHT_BRACKET";
            break;
          case " ":
            state = "RIGHT_BRACKET";
            break;
          default:
            return null;
        }
        break;
      case "RIGHT_BRACKET":
        if (body[cursor] == "]") {
          state = "BEFORE_CONTENT";
        } else {
          return null;
        }
        break;
      case "BEFORE_CONTENT":
        if (body[cursor] == " ") {
          state = "CONTENT";
        } else {
          return null;
        }
        break;
      case "CONTENT":
        switch (body[cursor]) {
          case " ":
            buffer = " ";
            state = "SPACE";
            break;
          case "(":
            buffer = "(";
            state = "LEFT_PARENTHESES";
            break;
          case "#":
            state = "LABEL";
            buffer = "";
            break;
          default:
            content += body[cursor];
            break;
        }
        break;
      case "SPACE":
        switch (body[cursor]) {
          case "(":
            buffer += "(";
            state = "LEFT_PARENTHESES";
            break;
          case "#":
            state = "LABEL";
            buffer = "";
            break;
          default:
            state = "CONTENT";
            content += " ";
            cursor--;
        }
        break;
      case "LEFT_PARENTHESES":
        switch (body[cursor]) {
          case "p":
            buffer += "p";
            state = "PRIORITY";
            break;
          case "@":
            buffer += "@";
            state = "DUE_DATE";
            break;
          default:
            state = "CONTENT";
            content += "(";
            cursor--;
        }
        break;
      case "LABEL":
        if (
          (body[cursor] >= "a" && body[cursor] <= "z") ||
          (body[cursor] >= "A" && body[cursor] <= "Z")
        ) {
          buffer += body[cursor];
        } else {
          if (buffer.length > 0) {
            labels.push(buffer);
            buffer = "";
          }

          state = "CONTENT";
          cursor--;
        }
        break;
      case "PRIORITY":
        let char = body[cursor];
        if (char >= "1" && char <= "4") {
          state = "AFTER_PRIORITY";
          if (cursor + 1 < body.length && body[cursor + 1] === ")") {
            priority = (5 - parseInt(char)) as Priority;
          } else {
            buffer += char;
          }
        } else {
          state = "CONTENT";
          content += buffer;
          cursor--;
        }
        break;
      case "AFTER_PRIORITY":
        if (body[cursor] == ")") {
          state = "CONTENT";
        } else {
          state = "CONTENT";
          content += buffer;
          cursor--;
        }
        break;
      case "DUE_DATE":
        if (body[cursor] == ")") {
          due = getDueDate(potentialDue);
          potentialDue = "";
          buffer = "";

          if (!due) {
            content += buffer + ")";
          }

          state = "CONTENT";
        } else {
          potentialDue += body[cursor];
          buffer += body[cursor];
        }
        break;
    }

    cursor++;
  }

  switch (state) {
    case "LABEL":
      if (buffer.length > 0) {
        labels.push(buffer);
      }
      break;
    case "DUE_DATE":
      if (potentialDue.length > 0) {
        due = getDueDate(potentialDue);
      }
      break;
  }

  return {
    project_id,
    id: id?.length > 0 ? id : null,
    content: content.trim(),
    completed,
    due: due,
    priority,
    labels,
    description: "",
    comments: {},
    mtime: mtime
  };
};

export type ProjectName = {
  name: string;
  id: string | null;
};

export const parseBaseName = (baseName: string): ProjectName => {
  let match = baseName.match(/^(?<name>.*?) - (?<id>\d+)?/);

  if (!match || !match.groups) {
    return { name: baseName, id: null };
  }

  let { name, id } = match.groups;

  return { name, id };
};

export const generateUUID = (): string => {
  return uuidv4();
};

const getDueDate = (date: string): DueDate | null => {
  let dateObj: Date;

  switch (date.toLowerCase()) {
    case "today":
      dateObj = new Date();
      break;
    case "tomorrow":
      dateObj = new Date();
      dateObj.setDate(dateObj.getDate() + 1);
      break;
    case "next week":
      dateObj = new Date();
      dateObj.setDate(dateObj.getDate() + 7);
      break;
    case "monday":
    case "tuesday":
    case "wednesday":
    case "thursday":
    case "friday":
    case "saturday":
    case "sunday":
      dateObj = new Date();
      const currentDay = dateObj.getDay();
      const targetDay = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday"
      ].indexOf(date);
      const dayDifference = (targetDay + 7 - currentDay) % 7;
      dateObj.setDate(dateObj.getDate() + dayDifference);
      break;
    default:
      // Fixed bug where date was off by one day
      // Reference: https://stackoverflow.com/questions/7556591/is-the-javascript-date-object-always-one-day-off
      dateObj = new Date(date.replaceAll("-", "/"));

      if (dateObj.toString() === "Invalid Date") {
        return null;
      }
      break;
  }

  const day = dateObj.getDate().toString().padStart(2, "0");
  const month = (dateObj.getMonth() + 1).toString().padStart(2, "0");

  return {
    date: `${dateObj.getFullYear()}-${month}-${day}`,
    timezone: null,
    string: `${getMonth(dateObj.getMonth() + 1)} ${day}`,
    lang: "en",
    is_recurring: false
  };
};

const getMonth = (month: number): string => {
  switch (month) {
    case 1:
      return "Jan";
    case 2:
      return "Feb";
    case 3:
      return "Mar";
    case 4:
      return "Apr";
    case 5:
      return "May";
    case 6:
      return "Jun";
    case 7:
      return "Jul";
    case 8:
      return "Aug";
    case 9:
      return "Sep";
    case 10:
      return "Oct";
    case 11:
      return "Nov";
    case 12:
      return "Dec";
    default:
      return "";
  }
};

export const compareDueDates = (a: DueDate, b: DueDate): boolean => {
  return a.date === b.date;
};

export const getUpdatedItem = (a: Todo, b: Todo): ItemUpdateArgs => {
  let update: ItemUpdateArgs = {
    id: a.id
  };

  if (a.content !== b.content) update.content = b.content;

  if (
    (!!a.due && !b.due) ||
    (!a.due && !!b.due) ||
    (a.due && b.due && !compareDueDates(a.due, b.due))
  )
    update.due = b.due;

  if (a.priority != b.priority) update.priority = b.priority;

  if (!arraysEqualUnordered(a.labels, b.labels)) update.labels = b.labels;

  if (a.description !== b.description) update.description = b.description;

  return update;
};

const arraysEqualUnordered = (arr1: string[], arr2: string[]): boolean => {
  if (arr1.length !== arr2.length) return false;
  if (arr1.length === 0) return true;

  const frequencyCounter1: { [key: string]: number } = {};
  const frequencyCounter2: { [key: string]: number } = {};

  for (let val of arr1) {
    frequencyCounter1[val] = (frequencyCounter1[val] || 0) + 1;
  }

  for (let val of arr2) {
    frequencyCounter2[val] = (frequencyCounter2[val] || 0) + 1;
  }

  for (let key in frequencyCounter1) {
    if (frequencyCounter1[key] !== frequencyCounter2[key]) return false;
  }

  return true;
};

export const shouldComplete = (syncedItem: Todo, item: Todo): boolean => {
  return !syncedItem.completed && item.completed;
};

export const shouldUncomplete = (syncedItem: Todo, item: Todo): boolean => {
  return syncedItem.completed && !item.completed;
};

export const removeHtml = (html: string): string => {
  let el = document.createElement("html");
  el.innerHTML = html;
  return el.textContent || "";
};

export const sortTodosTop = (body: TodoBody): TodoBody => {
  return body.sort((a, b) => {
    if (typeof a === "string") return 1;
    if (typeof b === "string") return -1;

    if (a.completed && !b.completed) return 1;

    if (!a.completed && b.completed) return -1;

    return b.priority - a.priority;
  });
};

export const sortTodos = (body: TodoBody): TodoBody => {
  let sortedArray: TodoBody = [];

  for (let i = 0; i < body.length; i++) {
    if (typeof body[i] === "string") {
      sortedArray.push(body[i]);
    } else {
      let group: TodoBody = [body[i]];
      let j = i + 1;
      while (j < body.length && typeof body[j] !== "string") {
        group.push(body[j]);
        j++;
      }
      i = j - 1;
      sortedArray.push(...sortTodosTop(group));
    }
  }

  return sortedArray;
};

export const insertTextAtPosition = (
  text: string,
  body: string,
  position: { lineStart: number; lineEnd: number }
): string => {
  const lines = body.split("\n");
  let cursor = 0;
  let newBody = "";

  while (cursor < lines.length) {
    if (cursor === position.lineStart) {
      newBody += text;
    }
    newBody += lines[cursor] + "\n";
    cursor++;
  }

  if (position.lineStart >= lines.length) {
    let diff = position.lineStart - lines.length;
    if (diff > 0) {
      newBody += "\n".repeat(diff - 1);
    }
    newBody += text;
  }

  return newBody;
};

type CodeBlockCleanState = "BEFORE_CODE" | "CODE";

export const ignoreCodeBlock = (body: string): string => {
  let state: CodeBlockCleanState = "BEFORE_CODE";
  let cursor = 0;
  let content = "";
  let lines = body.split("\n");

  while (cursor < lines.length) {
    switch (state) {
      case "BEFORE_CODE":
        if (lines[cursor].trim() === "```todomd") {
          state = "CODE";
        } else {
          content += lines[cursor] + "\n";
        }
        break;
      case "CODE":
        if (lines[cursor].trim() === "```") {
          state = "BEFORE_CODE";
        }
        break;
    }
    cursor++;
  }

  return content;
};

export const compareObjects = <T extends object>(a: T, b: T): boolean => {
  if (Object.keys(a).length !== Object.keys(b).length) return false;

  for (let key in a) {
    if (typeof a[key] === "object" && typeof b[key] === "object") {
      if (!compareObjects(a[key], b[key])) return false;
    } else if (a[key] !== b[key]) return false;
  }

  return true;
};

export const getmtime = (): number => Math.floor(Date.now() / 1000);
