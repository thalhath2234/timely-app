import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { api } from "../../lib/api/client";
import type { ChatImage } from "../../lib/chat/types";
import { styles } from "./shared";
export default function ImagePreview({
  image,
  large = false,
  onOpen,
}: {
  image: ChatImage;
  large?: boolean;
  onOpen?: (uri: string) => void;
}) {
  const [uri, setUri] = useState<string>();
  const [error, setError] = useState("");
  const expired =
    !!image.deletedAt || new Date(image.expiresAt).getTime() <= Date.now();
  useEffect(() => {
    if (expired) {
      setUri(undefined);
      return;
    }
    let active = true;
    void api<Response>(`/chats/images/${image.id}`, { response: true })
      .then(async (res) => {
        const bytes = new Uint8Array(await res.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        if (active)
          setUri(
            `data:${res.headers.get("content-type") || "image/jpeg"};base64,${btoa(binary)}`,
          );
      })
      .catch(() => {
        if (active) setError("Image unavailable. Re-upload to read it again.");
      });
    return () => {
      active = false;
    };
  }, [image.id, expired]);
  if (expired || error)
    return (
      <Text style={styles.muted}>
        {expired
          ? "Temporary image removed or expired. Extracted details are kept."
          : error}
      </Text>
    );
  return (
    <Pressable disabled={!uri || !onOpen} onPress={() => uri && onOpen?.(uri)}>
      <View>
        {uri ? (
          <Image
            source={{ uri }}
            style={{
              width: large ? "100%" : 100,
              height: large ? 280 : 100,
              borderRadius: 12,
            }}
            resizeMode="contain"
          />
        ) : (
          <Text style={styles.muted}>Loading image…</Text>
        )}
      </View>
    </Pressable>
  );
}
