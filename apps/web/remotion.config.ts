import { Config } from "@remotion/cli/config";

/** `pnpm film:studio` opens the landing-page film; `pnpm film:render` writes it to out/. */
Config.setEntryPoint("remotion/index.ts");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
