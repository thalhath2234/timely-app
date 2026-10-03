import { Redirect } from "expo-router";
import { isOnboarded, useAuth } from "../lib/auth/AuthProvider";
import { useServer } from "../lib/server/ServerProvider";
import StartupLoader from "../components/ui/StartupLoader";

export default function Index() {
  const { ready, token, user } = useAuth();
  const server = useServer();
  if (server.status === "unconfigured") return <Redirect href="/connect" />;
  if (!ready) return <StartupLoader />;
  if (!token) return <Redirect href="/login" />;
  if (!user) return <Redirect href="/login" />;
  if (!isOnboarded(user)) return <Redirect href="/onboarding" />;
  return <Redirect href="/(app)/(tabs)/home" />;
}
