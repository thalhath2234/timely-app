import { Redirect, useLocalSearchParams } from "expo-router";
import { fileHref } from "../../../../lib/fileRoutes";
import { routeParam } from "../../../../lib/sheet";

/** Legacy sheet template link; templates now open under /files/<id>. */
export default function LegacySheetTemplateRedirect() {
  const id = routeParam(useLocalSearchParams<{ id: string | string[] }>().id);
  return <Redirect href={fileHref(id)} />;
}
