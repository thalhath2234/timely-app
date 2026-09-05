import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { isOnboarded, useAuth } from "../../lib/auth/AuthProvider";
import { colors } from "../../lib/theme";

export default function AppLayout() {
  const { ready, token, user } = useAuth();
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!token) return <Redirect href="/login" />;
  if (!isOnboarded(user)) return <Redirect href="/onboarding" />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
  );
}
