export const parseResponse = <T>(response: string): T => {
  return JSON.parse(response);
};
