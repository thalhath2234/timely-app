import { Redirect } from "expo-router";
import { isOnboarded, useAuth } from "../lib/auth/AuthProvider";
import StartupLoader from "../components/ui/StartupLoader";

export default function Index() {
  const { ready, token, user } = useAuth();
  if (!ready) return <StartupLoader />;
  if (!token) return <Redirect href="/login" />;
  if (!user) return <Redirect href="/login" />;
  if (!isOnboarded(user)) return <Redirect href="/onboarding" />;
  return <Redirect href="/(app)/(tabs)/home" />;
}
