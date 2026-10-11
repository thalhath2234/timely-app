import { Redirect } from "expo-router";
import { FILES_TAB } from "../../../lib/fileRoutes";

/** Legacy /sheets link; docs and sheets now live in the Files tab. */
export default function LegacySheetsRedirect() {
  return <Redirect href={FILES_TAB} />;
}
