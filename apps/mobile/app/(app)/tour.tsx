import { useRef, useState } from "react";
import { Dimensions, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { AUTH, AuthButton, AuthLink } from "../../components/auth/AuthKit";
import LoopImage, { type LoopId } from "../../components/ui/LoopImage";
import { pageEntering } from "../../lib/motion";

/** The three things a new account sees once: the film's chapters as phone-sized loops. */
const PAGES: { id: LoopId; n: string; title: string; headline: string; body: string; color: string }[] = [
  {
    id: "capture",
    n: "01",
    title: "Capture",
    headline: "Get it out of your head.",
    body: "Type anything into the Inbox the moment you think of it, from the Quick add bar or a widget. Sort it later: a thought becomes a task, a reminder or a note when you review it.",
    color: "#6e56cf",
  },
  {
    id: "schedule",
    n: "03",
    title: "Auto-schedule",
    headline: "The week rearranges itself.",
    body: "Give a task an estimate and Timely finds it a slot in free time inside your working hours. When a meeting lands on top of it, the next run moves it.",
    color: "#ffb224",
  },
  {
    id: "cards",
    n: "06",
    title: "Dashboard cards",
    headline: "Build the card you need.",
    body: "The Dashboard is a grid you arrange yourself: timers, stats, charts, or a card built from your own tasks, events, a sheet or a doc. Every card can be a widget on your Home screen.",
    color: "#b8b7ff",
  },
];

export default function TourScreen() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const scroller = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const width = Dimensions.get("window").width;
  const last = page === PAGES.length - 1;
  const done = () => router.replace("/(app)/(tabs)/home");
  const goTo = (index: number) => {
    scroller.current?.scrollTo({ x: index * width, animated: !reduceMotion });
    setPage(index);
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    if (index !== page) setPage(index);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar style="light" />
      <Animated.View entering={pageEntering(reduceMotion)} style={styles.flex}>
        <View style={styles.header}>
          <Text style={styles.kicker}>THREE THINGS TO KNOW</Text>
          <AuthLink label="Skip" onPress={done} />
        </View>
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
          onScrollEndDrag={onScroll}
          style={styles.flex}
          keyboardShouldPersistTaps="handled"
          testID="tour-pager"
        >
          {PAGES.map((item) => (
            <View key={item.id} style={[styles.page, { width }]}>
              <LoopImage id={item.id} />
              <Text style={[styles.chapter, { color: item.color }]}>
                {item.n} · {item.title}
              </Text>
              <Text accessibilityRole="header" style={styles.headline}>
                {item.headline}
              </Text>
              <Text style={styles.body}>{item.body}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={styles.dots} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: PAGES.length, now: page + 1 }}>
          {PAGES.map((item, i) => (
            <View key={item.id} style={[styles.dot, i === page && { backgroundColor: item.color, width: 22 }]} />
          ))}
        </View>
        <View style={styles.actions}>
          <AuthButton label={last ? "Open Timely" : "Next"} onPress={() => (last ? done() : goTo(page + 1))} testID="tour-next" />
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AUTH.bg },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingTop: 12 },
  kicker: { color: AUTH.faint, fontSize: 11, fontFamily: AUTH.mono, letterSpacing: 1.2 },
  page: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 48, gap: 10, justifyContent: "center" },
  chapter: { marginTop: 10, fontSize: 12, fontFamily: AUTH.mono, letterSpacing: 0.6 },
  headline: { color: AUTH.ink, fontSize: 30, lineHeight: 34, fontFamily: AUTH.display },
  body: { color: AUTH.soft, fontSize: 15, lineHeight: 22 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, paddingVertical: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: AUTH.lineStrong },
  actions: { paddingHorizontal: 24, paddingBottom: 12 },
});
