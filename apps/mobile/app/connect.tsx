import { useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { ScanLine, X } from "lucide-react-native";
import Screen from "../components/ui/Screen";
import MobileHeader from "../components/ui/MobileHeader";
import TimelyLogo from "../components/ui/TimelyLogo";
import AnimatedPressable from "../components/ui/AnimatedPressable";
import { Field, PrimaryButton } from "../components/ui/primitives";
import { useAuth } from "../lib/auth/AuthProvider";
import { parsePairingInput } from "../lib/server";
import { useServer } from "../lib/server/ServerProvider";
import { colors, createThemedStyleSheet } from "../lib/theme";

const INVALID_INPUT =
  "Enter an address that starts with http:// or https://, or scan the QR code shown in Timely on your computer.";

/**
 * First screen on a fresh install (status "unconfigured") and the target of
 * Settings → Server → "Change server" (`?mode=change`). In change mode the
 * previous session is signed out only after the new server has answered, so
 * a failed attempt leaves everything as it was and Back returns to Settings.
 */
export default function ConnectScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const changing = params.mode === "change";
  const server = useServer();
  const auth = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const scanHandled = useRef(false);

  async function startScan() {
    setError("");
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError(
          result.canAskAgain
            ? "Camera access is needed to scan the QR code. You can paste the address instead."
            : "Camera access is turned off for Timely in system settings. Paste the address instead.",
        );
        return;
      }
    }
    scanHandled.current = false;
    setScanning(true);
  }

  async function connectTo(text: string) {
    const parsed = parsePairingInput(text);
    if (!parsed) {
      setError(INVALID_INPUT);
      return;
    }
    setError("");
    setPending(parsed.urls.length > 1 ? "Trying each address…" : "Connecting…");
    try {
      const sameServer = changing && server.config?.urls.includes(parsed.urls[0]) === true;
      await server.connect(parsed, {
        beforeApply: async () => {
          // Tokens belong to one server; a different one gets a fresh sign-in.
          if (changing && auth.token && !sameServer) await auth.logout();
        },
      });
      if (changing && sameServer && auth.token) {
        router.back();
        return;
      }
      router.replace("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setPending(null);
    }
  }

  function onBarcodeScanned(result: BarcodeScanningResult) {
    if (scanHandled.current) return;
    scanHandled.current = true;
    setScanning(false);
    setAddress(result.data.startsWith("{") ? "" : result.data);
    void connectTo(result.data);
  }

  return (
    <Screen>
      {changing ? <MobileHeader title="Change server" back large={false} /> : null}
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <TimelyLogo size={44} style={styles.logo} />
        <Text style={styles.title}>Connect to your Timely desktop</Text>
        <Text style={styles.sub}>
          Open Timely on your computer, go to Settings → Server, and scan the QR code it shows.
        </Text>
        {changing && server.activeUrl ? (
          <Text style={styles.current}>
            Currently connected to {server.name ? `${server.name} · ` : ""}
            {server.activeUrl}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {scanning ? (
          <View style={styles.cameraCard}>
            <CameraView
              style={styles.camera}
              facing="back"
              active={scanning}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={scanning ? onBarcodeScanned : undefined}
            />
            <View style={styles.cameraOverlay} pointerEvents="box-none">
              <Text style={styles.cameraHint}>Point at the QR code</Text>
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel="Stop scanning"
                onPress={() => setScanning(false)}
                style={styles.cameraClose}
              >
                <X size={18} color="#fff" />
              </AnimatedPressable>
            </View>
          </View>
        ) : (
          <AnimatedPressable
            testID="connect-scan"
            accessibilityRole="button"
            accessibilityLabel="Scan QR code"
            disabled={pending !== null}
            onPress={() => void startScan()}
            style={[styles.scan, pending !== null && { opacity: 0.4 }]}
          >
            <ScanLine size={20} color={colors.primary} />
            <Text style={styles.scanText}>Scan QR code</Text>
          </AnimatedPressable>
        )}

        <Text style={styles.or}>or paste the address</Text>
        <Field
          testID="connect-address"
          value={address}
          onChangeText={setAddress}
          placeholder="http://100.101.102.103:48080"
          keyboardType="url"
        />
        <PrimaryButton
          testID="connect-submit"
          label={pending ?? "Connect"}
          disabled={pending !== null || !address.trim()}
          onPress={() => void connectTo(address)}
        />
        <Text style={styles.note}>
          To reach your computer away from home, install the Tailscale app on this phone and sign in with the same account as on the computer. Traffic stays inside that private network even over http.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 24, gap: 14 },
  logo: { marginBottom: 4 },
  title: { color: colors.foreground, fontSize: 28, fontWeight: "700", letterSpacing: -0.6 },
  sub: { color: colors.mutedForeground, fontSize: 15, lineHeight: 21 },
  current: { color: colors.mutedForeground, fontSize: 13 },
  error: { color: colors.destructive, fontSize: 13, lineHeight: 18 },
  scan: {
    height: 56,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  scanText: { color: colors.primary, fontSize: 16, fontWeight: "700" },
  cameraCard: { borderRadius: 20, overflow: "hidden", backgroundColor: "#000", aspectRatio: 1 },
  camera: { flex: 1 },
  cameraOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  cameraHint: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  cameraClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  or: { color: colors.mutedForeground, fontSize: 13, textAlign: "center", marginTop: 4 },
  note: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 4 },
}));
