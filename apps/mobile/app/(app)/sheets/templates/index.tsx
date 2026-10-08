import { Redirect } from "expo-router";
import { FILES_TAB } from "../../../../lib/fileRoutes";

/** Legacy /sheets/templates link; sheet templates are listed in the Files tab. */
export default function LegacySheetTemplatesRedirect() {
  return <Redirect href={FILES_TAB} />;
}
