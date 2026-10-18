package com.timely.mobile;

import android.app.Application;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.view.View;
import android.view.ViewGroup;

import com.facebook.react.bridge.JavaOnlyArray;
import com.facebook.react.bridge.JavaOnlyMap;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReadableMap;
import com.reactnativeandroidwidget.builder.WidgetFactory;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * Draws every widget case from scripts/mobile-widget-native/cases.mjs with
 * react-native-android-widget's own Android code (Robolectric, native
 * graphics, xxhdpi), writes a PNG per case and theme plus report.json with
 * each tap area, and fails on a drawing error or on anything pushed past its
 * box or cut short. Run with `make test-mobile-widgets-native`.
 */
@RunWith(RobolectricTestRunner.class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = 34, qualifiers = "xxhdpi", application = android.app.Application.class)
public class WidgetDrawTest {
    static Object toRn(Object v) throws Exception {
        if (v instanceof JSONObject) {
            JSONObject o = (JSONObject) v;
            JavaOnlyMap m = new JavaOnlyMap();
            for (java.util.Iterator<String> it = o.keys(); it.hasNext(); ) {
                String k = it.next();
                Object c = o.get(k);
                if (c == JSONObject.NULL) m.putNull(k);
                else if (c instanceof JSONObject) m.putMap(k, (ReadableMap) toRn(c));
                else if (c instanceof JSONArray) m.putArray(k, (JavaOnlyArray) toRn(c));
                else if (c instanceof Boolean) m.putBoolean(k, (Boolean) c);
                else if (c instanceof Number) m.putDouble(k, ((Number) c).doubleValue());
                else m.putString(k, c.toString());
            }
            return m;
        }
        JSONArray a = (JSONArray) v;
        JavaOnlyArray arr = new JavaOnlyArray();
        for (int i = 0; i < a.length(); i++) {
            Object c = a.get(i);
            if (c == JSONObject.NULL) arr.pushNull();
            else if (c instanceof JSONObject) arr.pushMap((ReadableMap) toRn(c));
            else if (c instanceof JSONArray) arr.pushArray((JavaOnlyArray) toRn(c));
            else if (c instanceof Boolean) arr.pushBoolean((Boolean) c);
            else if (c instanceof Number) arr.pushDouble(((Number) c).doubleValue());
            else arr.pushString(c.toString());
        }
        return arr;
    }

    static String describe(View v) {
        if (v instanceof android.widget.TextView) return "text \"" + ((android.widget.TextView) v).getText() + "\"";
        return v.getClass().getSimpleName();
    }

    /** Line heights seen, by text size: what the renderer's lineH/figureH budget is based on. */
    static java.util.TreeSet<String> metrics = new java.util.TreeSet<>();

    /** Views pushed outside their parent's padded box, and text cut short or ellipsized. */
    static void findCuts(ViewGroup root, View v, JSONArray cuts, JSONArray ellipsized) throws Exception {
        if (v.getVisibility() != View.VISIBLE) return;
        float dp = v.getResources().getDisplayMetrics().density;
        if (v instanceof android.widget.TextView) {
            android.widget.TextView tv = (android.widget.TextView) v;
            android.text.Layout layout = tv.getLayout();
            if (layout != null && tv.getText().length() > 0) {
                int need = layout.getHeight() + tv.getCompoundPaddingTop() + tv.getCompoundPaddingBottom();
                if (need > tv.getHeight() + 2) cuts.put("cut " + describe(tv) + " needs " + Math.round(need / dp) + "dp, has " + Math.round(tv.getHeight() / dp));
                metrics.add(Math.round(tv.getTextSize() / v.getResources().getDisplayMetrics().scaledDensity) + "sp " + (tv.getTypeface() != null && tv.getTypeface().isBold() ? "bold " : "") + layout.getLineCount() + "L -> " + Math.round(need / dp) + "dp");
                for (int l = 0; l < layout.getLineCount(); l++) {
                    if (layout.getEllipsisCount(l) > 0) { ellipsized.put(tv.getText().toString()); break; }
                }
            }
        }
        if (v.getParent() instanceof ViewGroup && v != root) {
            ViewGroup parent = (ViewGroup) v.getParent();
            int slack = 2;
            if (v.getHeight() > 0 && (v.getBottom() > parent.getHeight() - parent.getPaddingBottom() + slack || v.getRight() > parent.getWidth() - parent.getPaddingRight() + slack || v.getTop() < parent.getPaddingTop() - slack)) {
                cuts.put("overflow " + describe(v) + " in " + parent.getClass().getSimpleName() + " by " + Math.round(Math.max(v.getBottom() - (parent.getHeight() - parent.getPaddingBottom()), v.getRight() - (parent.getWidth() - parent.getPaddingRight())) / dp) + "dp");
            }
        }
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) findCuts(root, g.getChildAt(i), cuts, ellipsized);
        }
    }

    /**
     * A sheet counter's −/+ on the phone (RNWidgetLocal): the count moves in
     * its file, "changed" follows it, and the figure is written the way the
     * cell writes it. Drawing to the launcher fails here; the file is written
     * before that.
     */
    @Test
    public void localTapsCountOnThePhone() throws Exception {
        Application app = RuntimeEnvironment.getApplication();
        File file = com.reactnativeandroidwidget.RNWidgetLocal.file(app, 7);
        String figure = "{{count:'$'#,##0.00;-'$'#,##0.00}}";
        JSONObject tree = new JSONObject().put("type", "TextWidget").put("props", new JSONObject().put("text", figure));
        JSONObject trees = new JSONObject().put("light", tree).put("dark", tree);
        JSONObject doc = new JSONObject()
            .put("state", new JSONObject().put("count", 1250).put("base", 1250).put("changed", "no").put("cell", "s/t/r/c"))
            .put("variantKey", "changed")
            .put("limits", new JSONObject())
            .put("differs", new JSONObject().put("changed", new JSONArray().put("count").put("base")))
            .put("variants", new JSONObject().put("no", trees).put("yes", trees));
        Files.write(file.toPath(), doc.toString().getBytes(StandardCharsets.UTF_8));
        java.util.function.DoubleConsumer tap = (by) -> {
            android.os.Bundle data = new android.os.Bundle();
            data.putString("step", "count");
            data.putDouble("by", by);
            try {
                com.reactnativeandroidwidget.RNWidgetLocal.handle(app, "TimelyCard", 7, data);
            } catch (Throwable e) {
                // React Native's native maps don't load under Robolectric; the file is saved before the draw.
            }
        };
        java.util.function.Supplier<JSONObject> state = () -> {
            try {
                return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)).getJSONObject("state");
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        };
        tap.accept(0.1);
        tap.accept(0.2);
        if (state.get().getDouble("count") != 1250.3 || !"yes".equals(state.get().getString("changed"))) throw new AssertionError("after +0.1 +0.2: " + state.get());
        tap.accept(-0.3);
        if (state.get().getDouble("count") != 1250 || !"no".equals(state.get().getString("changed"))) throw new AssertionError("back to saved: " + state.get());
        Method fill = com.reactnativeandroidwidget.RNWidgetLocal.class.getDeclaredMethod("fill", Object.class, JSONObject.class);
        fill.setAccessible(true);
        for (double[] each : new double[][] {{1255, 0}, {-2, 1}, {0, 2}}) {
            String text = (String) fill.invoke(null, figure, new JSONObject().put("count", each[0]));
            String want = new String[] {"$1,255.00", "-$2.00", "$0.00"}[(int) each[1]];
            if (!want.equals(text)) throw new AssertionError(each[0] + " drew as " + text + ", not " + want);
        }
        System.out.println("LOCAL COUNTER TAPS: ok");
    }

    @Test
    public void drawAll() throws Exception {
        String casesPath = System.getProperty("widgetCases");
        File out = new File(System.getProperty("widgetOut"));
        out.mkdirs();
        JSONArray cases = new JSONArray(new String(Files.readAllBytes(Paths.get(casesPath)), StandardCharsets.UTF_8));
        Application app = RuntimeEnvironment.getApplication();
        com.facebook.react.uimanager.DisplayMetricsHolder.initDisplayMetricsIfNotInitialized(app);
        ReactApplicationContext ctx = new com.facebook.react.bridge.BridgeReactContext(app);
        Constructor<WidgetFactory> ctor = WidgetFactory.class.getDeclaredConstructor();
        ctor.setAccessible(true);
        Method build = WidgetFactory.class.getDeclaredMethod("buildWidget", ReactApplicationContext.class, ReadableMap.class, String.class);
        build.setAccessible(true);
        Field clickables = WidgetFactory.class.getDeclaredField("clickableViews");
        clickables.setAccessible(true);
        JSONArray report = new JSONArray();
        int failed = 0;
        int cut = 0;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            for (String theme : new String[] {"light", "dark"}) {
                JSONObject entry = new JSONObject();
                entry.put("index", i).put("theme", theme).put("group", c.getString("group")).put("name", c.getString("name"));
                try {
                    WidgetFactory factory = ctor.newInstance();
                    JavaOnlyMap props = new JavaOnlyMap();
                    props.putInt("widgetWidth", c.getInt("width"));
                    props.putInt("widgetHeight", c.getInt("height"));
                    JavaOnlyArray children = new JavaOnlyArray();
                    children.pushMap((ReadableMap) toRn(c.getJSONObject(theme)));
                    JavaOnlyMap root = new JavaOnlyMap();
                    root.putString("type", "RootWidget");
                    root.putMap("props", props);
                    root.putArray("children", children);
                    View view = (View) build.invoke(factory, ctx, root, "0");
                    Bitmap bitmap = Bitmap.createBitmap(view.getMeasuredWidth(), view.getMeasuredHeight(), Bitmap.Config.ARGB_8888);
                    view.draw(new Canvas(bitmap));
                    String file = String.format("%03d-%s.png", i, theme);
                    try (FileOutputStream fos = new FileOutputStream(new File(out, file))) {
                        bitmap.compress(Bitmap.CompressFormat.PNG, 100, fos);
                    }
                    JSONArray areas = new JSONArray();
                    for (Object cv : (List<?>) clickables.get(factory)) {
                        View v = (View) cv.getClass().getMethod("getView").invoke(cv);
                        Rect r = new Rect();
                        v.getDrawingRect(r);
                        ((ViewGroup) view).offsetDescendantRectToMyCoords(v, r);
                        Object data = cv.getClass().getMethod("getClickActionData").invoke(cv);
                        String label = data instanceof ReadableMap && ((ReadableMap) data).hasKey("uri") ? ((ReadableMap) data).getString("uri") : String.valueOf(cv.getClass().getMethod("getClickAction").invoke(cv));
                        areas.put(new JSONObject().put("l", r.left).put("t", r.top).put("r", r.right).put("b", r.bottom).put("what", label));
                    }
                    JSONArray cuts = new JSONArray(); JSONArray ellipsized = new JSONArray();
                    findCuts((ViewGroup) view, view, cuts, ellipsized);
                    if (cuts.length() > 0) cut++;
                    entry.put("file", file).put("w", bitmap.getWidth()).put("h", bitmap.getHeight()).put("areas", areas).put("cuts", cuts).put("ellipsized", ellipsized);
                } catch (Throwable e) {
                    Throwable cause = e.getCause() != null ? e.getCause() : e;
                    entry.put("error", cause.toString());
                    failed++;
                }
                report.put(entry);
            }
        }
        Files.write(Paths.get(out.getPath(), "report.json"), report.toString(1).getBytes(StandardCharsets.UTF_8));
        Files.write(Paths.get(out.getPath(), "metrics.txt"), String.join("\n", metrics).getBytes(StandardCharsets.UTF_8));
        System.out.println("WIDGETS DRAWN: " + report.length() + ", FAILED: " + failed + ", CUT: " + cut + ", OUT: " + out.getPath());
        if (failed > 0 || cut > 0) throw new AssertionError(failed + " widget drawings failed and " + cut + " cut something off; see " + out.getPath() + "/report.json");
    }
}
