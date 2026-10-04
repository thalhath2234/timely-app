import { File } from "expo-file-system";
import { api } from "./client";
import { isOffline } from "../networkState";
import { deviceTimezone } from "../format";
import type { Chat, ChatImage, PendingImage } from "../chat/types";

export function chatRequest<T = Chat>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (method !== "GET" && isOffline())
    return Promise.reject(
      new Error("Reconnect before sending messages or applying changes."),
    );
  // New messages carry the device zone; the agent uses it when no timezone
  // is saved in Working hours.
  const sendsMessage =
    method === "POST" && (path === "" || path.endsWith("/messages"));
  if (
    sendsMessage &&
    body &&
    typeof body === "object" &&
    !(body instanceof FormData)
  )
    body = { ...body, timezone: deviceTimezone() };
  return api<T>(`/chats${path}`, { method, body, queueIfOffline: false });
}
export async function uploadChatImage(image: PendingImage): Promise<ChatImage> {
  const form = new FormData();
  // SDK 57 fetch consumes Blob-compatible Expo files; legacy URI descriptors are rejected.
  form.append("image", new File(image.uri));
  return chatRequest<ChatImage>("/images", "POST", form);
}
export const renameChat = (id: string, title: string) =>
  chatRequest(`/${encodeURIComponent(id)}`, "PATCH", { title });
export const deleteChat = (id: string) =>
  chatRequest<void>(`/${encodeURIComponent(id)}`, "DELETE");
