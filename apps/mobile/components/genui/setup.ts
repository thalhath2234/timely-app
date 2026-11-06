// @openuidev/react-lang's browser build (Expo web) mounts its Inspect widget
// in development unless this flag is already set when it loads. Timely never
// shows it, so import this module before the package.
(globalThis as Record<symbol, unknown>)[Symbol.for("openui.devtools.autoMount")] = true;

export {};
