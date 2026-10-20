export class ApiError extends Error {constructor(message:string,public status:number){super(message);this.name="ApiError"}}
export async function api<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api" + url, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error || "Не удалось выполнить запрос",response.status);
  return data;
}
export const json = (body: unknown, method = "POST") => ({
  method,
  body: JSON.stringify(body),
});
export type User = {
  id: string;
  name: string;
  email: string;
  brand: { name?: string; colors?: string[]; font?: string };
};
export type DesignPage = { id: string; canvas: any;notes?:string;transition?:'none'|'fade'|'slide' };
export type Project = {
  id: string;
  title: string;
  kind: string;
  width: number;
  height: number;
  document: { pages: DesignPage[] };
  revision: number;
  role: "owner" | "editor" | "viewer";
  thumbnail?: string;
  folder: string;
  favorite: number;
  deleted: number;
  updated: string;
};
export const uid = () =>
  crypto.randomUUID?.() ||
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
