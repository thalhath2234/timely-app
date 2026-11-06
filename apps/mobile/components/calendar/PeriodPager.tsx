import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { FlatList, Platform, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

/**
 * Pages sideways through numbered periods (months, weeks). Every page has a
 * fixed slot in one long list, so the list never re-centres after a swipe:
 * nothing moves under the finger when the selection changes, and a settled
 * page is read from where the list stopped, not counted from the last one.
 */
export default function PeriodPager({
  index,
  count,
  width,
  onIndexChange,
  renderPage,
  extraData,
}: {
  index: number;
  count: number;
  width: number;
  onIndexChange: (index: number) => void;
  renderPage: (index: number) => ReactElement;
  extraData?: unknown;
}) {
  const list = useRef<FlatList<number>>(null);
  const shown = useRef(index);
  // Where a scroll we started is heading. Android ends a scroll it cuts short
  // (a second chevron tap) with a momentum event at the page it had reached.
  const target = useRef<number | null>(null);
  const pages = useMemo(() => Array.from({ length: count }, (_, page) => page), [count]);
  // Opens on the page itself (without it the first frame is page 0's blank
  // spacer). Set once per width: the native scroller jumps whenever it changes.
  // react-native-web ignores it, and the list then skips its own first scroll.
  const openAt = useMemo(() => (Platform.OS === "web" ? undefined : { x: shown.current * width, y: 0 }), [width]);

  useEffect(() => {
    if (shown.current === index) return;
    shown.current = index;
    target.current = index;
    list.current?.scrollToIndex({ index, animated: true });
  }, [index]);

  function settle(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const page = Math.min(count - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width)));
    if (target.current !== null) {
      if (page !== target.current) return;
      target.current = null;
    }
    if (page === shown.current) return;
    shown.current = page;
    onIndexChange(page);
  }

  return (
    <FlatList
      key={width}
      ref={list}
      data={pages}
      extraData={extraData}
      keyExtractor={String}
      renderItem={({ item }) => renderPage(item)}
      horizontal
      pagingEnabled
      decelerationRate="fast"
      initialScrollIndex={index}
      contentOffset={openAt}
      getItemLayout={(_, page) => ({ length: width, offset: width * page, index: page })}
      initialNumToRender={1}
      maxToRenderPerBatch={2}
      windowSize={3}
      onScrollBeginDrag={() => {
        target.current = null;
      }}
      onMomentumScrollEnd={settle}
      onScrollEndDrag={(event) => {
        // iOS sends no momentum events for a release that needs no snap; Android always does.
        if (Platform.OS === "ios" && Math.abs(event.nativeEvent.velocity?.x ?? 0) < 0.05) settle(event);
      }}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={{ flexGrow: 0 }}
    />
  );
}
