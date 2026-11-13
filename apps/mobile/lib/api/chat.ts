import { File } from "expo-file-system";
import { GENUI_CAPABILITY } from "@timely/contract/genui";
import { api } from "./client";
import { isOffline } from "../networkState";
import { deviceTimezone } from "../format";
import type { Chat, ChatImage, PendingImage } from "../chat/types";
import type {
  AgentChatSettings,
  AgentChatSettingsPatch,
  AnswerQuestionInput,
  ChatEngine,
  PermissionMode,
} from "@timely/contract/agentChat";

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
  // is saved in Working hours. client=phone makes its saved-view tools act on
  // the phone's own views, and `ui` says this app draws reply cards. Try
  // again sends them too, so a run retried here uses this device.
  const sendsDevice =
    method === "POST" &&
    (path === "" || path.endsWith("/messages") || path.endsWith("/retry"));
  if (sendsDevice && !(body instanceof FormData))
    body = {
      ...(body && typeof body === "object" ? body : {}),
      timezone: deviceTimezone(),
      client: "phone",
      ui: GENUI_CAPABILITY,
    };
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

// Chat on the agent engine (Settings → Agent → Engine and Permissions).
export const getAgentChatSettings = () =>
  api<AgentChatSettings>("/agent/chat-settings");
export const patchAgentChatSettings = (patch: AgentChatSettingsPatch) => {
  if (isOffline())
    return Promise.reject(new Error("Reconnect to change agent settings."));
  return api<AgentChatSettings>("/agent/chat-settings", {
    method: "PATCH",
    body: patch,
    queueIfOffline: false,
  });
};
/** A chat's own permission mode or engine ("" follows the account). */
export const configureChatAgent = (
  id: string,
  fields: { permission?: PermissionMode; engine?: ChatEngine },
) => chatRequest(`/${encodeURIComponent(id)}`, "PATCH", fields);
/** "Don't learn from this chat" (PATCH /chats/:id {noLearning}); the answer is the whole chat. */
export const setChatNoLearning = (id: string, noLearning: boolean) =>
  chatRequest(`/${encodeURIComponent(id)}`, "PATCH", { noLearning });
/**
 * Adds text to the agent run that is live in this chat (409 once it ended).
 * questionRequestId is the card this screen shows ("" for none): the text
 * answers a waiting card only when the sender read that card.
 */
export const steerChat = (id: string, text: string, questionRequestId = "") =>
  chatRequest(`/${encodeURIComponent(id)}/steer`, "POST", { text, questionRequestId });
/** Answers the question card the live run waits on, or skips it (409 once the card closed). */
export const answerQuestion = (id: string, input: AnswerQuestionInput) =>
  chatRequest(`/${encodeURIComponent(id)}/answer`, "POST", input);
/** Puts back what an auto-applied proposal changed; messageId is that proposal's message. */
export const undoChatChange = (id: string, revision: number, messageId: string) =>
  chatRequest(`/${encodeURIComponent(id)}/undo`, "POST", { revision, messageId });
