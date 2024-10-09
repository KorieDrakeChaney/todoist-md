import { requestUrl } from "obsidian";

export type RequestParams = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

export type WebResponse = {
  status: number;
  body: string;
};

export const obsidianFetch = async (
  params: RequestParams
): Promise<WebResponse> => {
  try {
    const response = await requestUrl({
      url: params.url,
      method: params.method,
      headers: params.headers,
      body: params.body
    });

    return {
      status: response.status,
      body: response.text
    };
  } catch (error: unknown) {
    let status = retrieveStatus(error.toString());
    return {
      status,
      body: getErrorMessage(status)
    };
  }
};

type StatusState = "WORD" | "SPACE" | "NUMBER" | "END";

const retrieveStatus = (response: string): number => {
  let buffer = "";
  let status = "";
  let cursor = 0;
  let state: StatusState = "WORD";

  while (cursor < response.length) {
    const char = response[cursor];
    switch (state) {
      case "WORD":
        switch (char) {
          case " ":
            state = "SPACE";
            break;
          default:
            buffer += char;
            break;
        }
        break;
      case "SPACE":
        switch (buffer) {
          case "status":
            state = "NUMBER";
            break;
          default:
            state = "WORD";
            buffer = "";
        }
        cursor--;
        break;
      case "NUMBER":
        if (char === " ") {
          state = "END";
        } else {
          status += char;
        }
        break;
      case "END":
        return parseInt(status);
    }
    cursor++;
  }

  if (status.length > 0) {
    return parseInt(status);
  }

  return 0;
};

const getErrorMessage = (status: number): string => {
  switch (status) {
    case 200:
      return "OK";
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 429:
      return "Too Many Requests";
    case 500:
      return "Internal Server Error";
    case 503:
      return "Service Unavailable";
    default:
      return "Unknown Error";
  }
};
