import { Redirect } from "expo-router";
import { FILES_TAB } from "../../../lib/fileRoutes";

/** Legacy /docs link; docs and sheets now live in the Files tab. */
export default function LegacyDocsRedirect() {
  return <Redirect href={FILES_TAB} />;
}
