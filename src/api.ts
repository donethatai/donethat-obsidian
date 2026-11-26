import {requestUrl} from "obsidian";
import {ReportRow} from "./format";

/**
 * The one call this plugin makes to DoneThat's public API. It is read only,
 * goes to https://api.donethat.ai, and carries the user's API key in the
 * `x-api-key` header and the day's start and end in its body. Nothing else
 * is sent.
 */

const API_BASE_URL = "https://api.donethat.ai";

/** A failure the user can do something about. */
export class DoneThatError extends Error {
  /**
   * @param message What to show the user
   * @param status HTTP status, when the server answered
   */
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "DoneThatError";
  }
}

/**
 * Turns a failed answer into something worth reading.
 * @param status HTTP status
 * @param serverMessage The API's own error text, when it sent one
 * @return The error to throw
 */
function failure(status: number, serverMessage: string | undefined): DoneThatError {
  if (status === 401) return new DoneThatError("DoneThat did not accept the API key. Check it in the plugin settings.", status);
  if (status === 403) {
    return new DoneThatError(
      serverMessage ?? "This API key may not read reports. It needs the reports:read scope, and API access is on the Core plan and above.",
      status
    );
  }
  if (status === 429) return new DoneThatError("DoneThat is receiving too many requests. Try again in a minute.", status);
  return new DoneThatError(serverMessage ?? `DoneThat answered with an error (${status}).`, status);
}

/**
 * Calls the API and returns the parsed answer.
 * @param apiKey The user's API key
 * @param path Path with query string
 * @param body JSON body; when given the call is a POST
 * @return The answer's JSON, and its status
 */
async function call(apiKey: string, path: string, body?: unknown): Promise<{status: number; json: Record<string, unknown>}> {
  let response;
  try {
    response = await requestUrl({
      url: `${API_BASE_URL}${path}`,
      method: body === undefined ? "GET" : "POST",
      headers: {"x-api-key": apiKey, "Accept": "application/json"},
      ...(body === undefined ? {} : {contentType: "application/json", body: JSON.stringify(body)}),
      throw: false,
    });
  } catch {
    throw new DoneThatError("Could not reach DoneThat. Check your connection.");
  }
  let json: Record<string, unknown> = {};
  try {
    const parsed: unknown = response.json;
    if (parsed && typeof parsed === "object") json = parsed as Record<string, unknown>;
  } catch {
    // An answer that is not JSON is treated as an empty one; the status still decides.
  }
  return {status: response.status, json};
}

/**
 * The work recorded in a stretch of time, one row per task.
 * @param apiKey The user's API key
 * @param from Start, epoch milliseconds, inclusive
 * @param to End, epoch milliseconds, exclusive
 * @return Report rows
 */
export async function fetchTasks(apiKey: string, from: number, to: number): Promise<ReportRow[]> {
  const {status, json} = await call(apiKey, "/report", {dateRange: {from, to}, aggregationLevel: "task"});
  if (status !== 200) throw failure(status, typeof json.error === "string" ? json.error : undefined);
  return Array.isArray(json.rows) ? (json.rows as ReportRow[]) : [];
}
