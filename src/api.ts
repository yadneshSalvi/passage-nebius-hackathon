export class ApiError extends Error {
  code: string;
  constructor(message: string, code = "REQUEST_FAILED") {
    super(message);
    this.code = code;
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/v1${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      body?.error?.message ||
        `The request could not finish (${response.status}). Please retry.`,
      body?.error?.code,
    );
  }
  return response.json();
}
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export function download(
  value: unknown,
  name: string,
  mediaType = "application/json",
) {
  const blob =
    value instanceof Blob
      ? value
      : new Blob(
          [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
          { type: mediaType },
        );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
