// Instant push needs two things the maintainer makes once (docs/mobile/push.md):
// an Expo project id and Firebase's google-services.json. Neither is in the
// repo, so a build without them keeps checking for alerts in the background
// (lib/serverNotifications.ts) and adding them later needs no code change.
//
// Pure and dependency-free so `make test-mobile-push` can load it with Node.

const GOOGLE_SERVICES = "./google-services.json";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The project id comes from TIMELY_EAS_PROJECT_ID in the process env, else
 * the root .env, else app.json's extra.eas.projectId. Firebase's file is used
 * only when it sits next to app.json (it is git-ignored). `extra` is what the
 * app reads: `fcm` says whether Android can get a token, so an Android build
 * with the id but without Firebase's file reports no push project
 * (lib/pushStatus.ts pushProjectId) instead of failing on every start.
 *
 * @param {{ env?: Record<string, string | undefined>, dotEnv?: Record<string, string>, appJson?: any, exists: (path: string) => boolean }} input
 * @returns {{ projectId: string | null, googleServicesFile: string | null, extra: { eas?: { projectId: string }, fcm?: true } }}
 */
function pushConfig({ env = {}, dotEnv = {}, appJson = {}, exists }) {
  const projectId =
    clean(env.TIMELY_EAS_PROJECT_ID) ||
    clean(dotEnv.TIMELY_EAS_PROJECT_ID) ||
    clean(appJson?.expo?.extra?.eas?.projectId);
  const googleServicesFile = exists(GOOGLE_SERVICES) ? GOOGLE_SERVICES : null;
  return {
    projectId: projectId || null,
    googleServicesFile,
    extra: projectId ? { eas: { projectId }, ...(googleServicesFile ? { fcm: true } : {}) } : {},
  };
}

module.exports = { pushConfig };
