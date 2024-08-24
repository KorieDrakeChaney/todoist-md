import type { ItemUpdateArgs } from "./arguments";
import type { DueDate, Priority, Todo, TodoBody, TodoItem } from "./types";
import { v4 as uuidv4 } from "uuid";

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
  | "BEFORE_ID"
  | "SINGLE_HYPHEN"
  | "DOUBLE_HYPHEN"
  | "ID"
  | "LABEL"
  | "END";

export const parseTodo = (
  line: string,
  isCodeBlock: boolean = false
): Todo | null => {
  if (line.length === 0) {
    return null;
  }

  line = removeHtml(line);

  let state: TodoParseState = "BEFORE_COMPLETED";

  let cursor = 0;

  let completed = false;
  let content = "";
  let due: DueDate;
  let id = "";
  let potentialDue = "";
  let priority: Priority;
  let labels: string[] = [];

  let buffer = "";
  while (true) {
    if (cursor >= line.length) {
      break;
    }

    switch (state) {
      case "BEFORE_COMPLETED":
        if (cursor == 0 && line[cursor] == "-") {
          state = "COMPLETED_SPACE";
        } else {
          return null;
        }
        break;
      case "COMPLETED_SPACE":
        if (line[cursor] == " ") {
          if (isCodeBlock) state = "CONTENT";
          else state = "LEFT_BRACKET";
        } else {
          return null;
        }
        break;
      case "LEFT_BRACKET":
        if (line[cursor] == "[") {
          state = "COMPLETED_CHECK";
        } else {
          return null;
        }
        break;
      case "COMPLETED_CHECK":
        switch (line[cursor]) {
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
        if (line[cursor] == "]") {
          state = "BEFORE_CONTENT";
        } else {
          return null;
        }
        break;
      case "BEFORE_CONTENT":
        if (line[cursor] == " ") {
          state = "CONTENT";
        } else {
          return null;
        }
        break;
      case "CONTENT":
        switch (line[cursor]) {
          case " ":
            buffer = " ";
            state = "SPACE";
            break;
          case "(":
            buffer = "(";
            state = "LEFT_PARENTHESES";
            break;
          case "<":
            buffer = "<";
            state = "BEFORE_ID";
            break;
          case "#":
            state = "LABEL";
            break;
          default:
            content += line[cursor];
            break;
        }
        break;
      case "SPACE":
        switch (line[cursor]) {
          case "(":
            buffer += "(";
            state = "LEFT_PARENTHESES";
            break;
          case "<":
            buffer += "<";
            state = "BEFORE_ID";
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
        switch (line[cursor]) {
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
          (line[cursor] >= "a" && line[cursor] <= "z") ||
          (line[cursor] >= "A" && line[cursor] <= "Z")
        ) {
          buffer += line[cursor];
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
        state = "AFTER_PRIORITY";
        if (line.charAt(cursor) >= "1" && line.charAt(cursor) <= "4") {
          priority = (5 - parseInt(line[cursor])) as Priority;
          buffer += line[cursor];
        } else {
          content += buffer;
          cursor--;
        }
        break;
      case "AFTER_PRIORITY":
        if (line[cursor] == ")") {
          state = "CONTENT";
        } else {
          priority = undefined;
          content += buffer;
          cursor--;
        }
        break;
      case "DUE_DATE":
        if (line[cursor] == ")") {
          due = getDueDate(potentialDue);
          potentialDue = "";
          buffer = "";

          if (!due) {
            content += buffer + ")";
          }

          state = "CONTENT";
        } else {
          potentialDue += line[cursor];
          buffer += line[cursor];
        }
        break;
      case "BEFORE_ID":
        if (line[cursor] == "!") {
          state = "SINGLE_HYPHEN";
          buffer += "!";
        } else {
          state = "CONTENT";
          content += buffer;
          cursor--;
        }
        break;
      case "SINGLE_HYPHEN":
        if (line[cursor] == "-") {
          state = "DOUBLE_HYPHEN";
          buffer += "-";
        } else {
          state = "CONTENT";
          content += buffer;
          cursor--;
        }
        break;
      case "DOUBLE_HYPHEN":
        if (line[cursor] == "-") {
          state = "ID";
          buffer += "-";
        } else {
          state = "CONTENT";
          content += buffer;
          cursor--;
        }
        break;
      case "ID":
        const charCode = line.charCodeAt(cursor);
        if (line[cursor] == "-") {
          state = "END";
        } else if (charCode >= 48 && charCode <= 57) {
          id += line[cursor];
        }
        break;
      case "END":
        return {
          id: id,
          content: content.trimEnd().trimStart(),
          completed,
          due: due,
          priority,
          labels
        };
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
    case "ID":
      if (id.length > 0) {
        id = id;
      }
      break;
  }

  return {
    id: id.length > 0 ? id : null,
    content: content.trimEnd().trimStart(),
    completed,
    due: due,
    priority,
    labels
  };
};

export type ProjectName = {
  name: string;
  id: string | null;
};

type ProjectParseState =
  | "NAME"
  | "BEFORE_NAME"
  | "ID"
  | "BEFORE_ID"
  | "BEFORE_HYPHEN"
  | "EXTENSION";

export const parseFile = (fileName: string): ProjectName => {
  let id = "";
  let name = "";
  let cursor = 0;

  let state: ProjectParseState = "NAME";

  while (true) {
    if (cursor >= fileName.length) {
      break;
    }

    switch (state) {
      case "NAME":
        switch (fileName[cursor]) {
          case ".":
            state = "EXTENSION";
            break;
          case " ":
            state = "BEFORE_HYPHEN";
            break;
          default:
            name += fileName[cursor];
            break;
        }
        break;
      case "BEFORE_HYPHEN":
        if (fileName[cursor] == "-") {
          state = "BEFORE_ID";
        } else {
          name += " " + fileName[cursor];
          state = "NAME";
        }
        break;
      case "BEFORE_ID":
        if (fileName[cursor] == " ") {
          state = "ID";
        } else {
          name += " -" + fileName[cursor];
        }
        break;
      case "EXTENSION":
        break;
      case "ID":
        switch (fileName[cursor]) {
          case ".":
            state = "EXTENSION";
            break;
          default:
            id += fileName[cursor];
            break;
        }
        break;
    }

    cursor++;
  }

  if (id.length > 0) {
    if (isNaN(parseInt(id))) {
      name += " - " + id;
      id = "";
    }
  }

  return {
    id: id.length > 0 ? id : null,
    name: name.split("/").pop()
  };
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
      dateObj = new Date(date);

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

export const getUpdatedItem = (a: TodoItem, b: Todo): ItemUpdateArgs => {
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

export const shouldComplete = (syncedItem: TodoItem, item: Todo): boolean => {
  return !syncedItem.completed && item.completed;
};

export const shouldUncomplete = (syncedItem: TodoItem, item: Todo): boolean => {
  return syncedItem.completed && !item.completed;
};

type HtmlParseState =
  | "DATA"
  | "TAG_NAME"
  | "AFTER_NAME"
  | "END_TAG_NAME"
  | "SELF_CLOSING";

//@todo edge cases of '<' and '>' in content
const removeHtml = (html: string): string => {
  let state: HtmlParseState = "DATA";
  let cursor = 0;
  let content = "";
  let currentTag = "";
  let buffer = "";
  while (cursor < html.length) {
    switch (state) {
      case "DATA":
        if (html[cursor] === "<") {
          state = "TAG_NAME";
        } else {
          content += html[cursor];
        }
        break;
      case "TAG_NAME":
        switch (html[cursor]) {
          case "/":
            if (buffer.length > 0) {
              state = "SELF_CLOSING";
            } else {
              state = "END_TAG_NAME";
            }
            break;
          case ">":
            if (buffer.length > 0) {
              currentTag = buffer;
              buffer = "";
            } else {
              content += "<>";
            }
            state = "DATA";
            break;
          case "!":
            state = "DATA";
            content += "<!";
            break;
          case " ":
            if (buffer.length > 0) {
              currentTag = buffer;
              buffer = "";
            }
            state = "AFTER_NAME";
            break;
          default:
            buffer += html[cursor];
            break;
        }
        break;
      case "AFTER_NAME":
        if (html[cursor] === ">") {
          state = "DATA";
        }
        break;
      case "SELF_CLOSING":
        if (html[cursor] === ">") {
          state = "DATA";
        }
        break;
      case "END_TAG_NAME":
        if (html[cursor] === ">") {
          if (buffer === currentTag) {
            buffer = "";
            currentTag = "";
          } else {
            content += "</" + buffer + ">";
          }
          state = "DATA";
        } else {
          buffer += html[cursor];
        }
        break;
    }
    cursor++;
  }

  return content;
};

export const sortTodos = (body: TodoBody): TodoBody => {
  return body.sort((a, b) => {
    if (typeof a === "string") return 1;
    if (typeof b === "string") return -1;

    return b.priority - a.priority;
  });
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
