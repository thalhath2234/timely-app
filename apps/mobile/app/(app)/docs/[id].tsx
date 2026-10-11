import { Redirect, useLocalSearchParams } from "expo-router";
import { fileHref } from "../../../lib/fileRoutes";
import { routeParam } from "../../../lib/sheet";

/** Legacy doc link; docs now open under /files/<id>. */
export default function LegacyDocRedirect() {
  const id = routeParam(useLocalSearchParams<{ id: string | string[] }>().id);
  return <Redirect href={fileHref(id)} />;
}
