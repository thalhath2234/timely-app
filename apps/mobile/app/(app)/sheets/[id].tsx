import { Redirect, useLocalSearchParams } from "expo-router";
import { fileHref } from "../../../lib/fileRoutes";
import { routeParam } from "../../../lib/sheet";

/** Legacy sheet link; sheets now open under /files/<id>. */
export default function LegacySheetRedirect() {
  const id = routeParam(useLocalSearchParams<{ id: string | string[] }>().id);
  return <Redirect href={fileHref(id)} />;
}
