import { User } from "@/app/_types/types";

export async function getMe(): Promise<User> {
  const response = await fetch("http://localhost:8080/me", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch user");
  }

  return response.json();
}