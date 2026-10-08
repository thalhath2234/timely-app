import { useLocalSearchParams } from "expo-router";
import DocScreen from "../../../components/docs/DocScreen";
import SheetScreen from "../../../components/sheets/SheetScreen";
import SheetTemplateScreen from "../../../components/sheets/SheetTemplateScreen";
import { fileKind } from "../../../lib/fileRoutes";
import { routeParam } from "../../../lib/sheet";

/** One detail route for every file; the ID's prefix picks the editor. */
export default function FileScreen() {
  const id = routeParam(useLocalSearchParams<{ id: string | string[] }>().id);
  const kind = fileKind(id);
  if (kind === "template") return <SheetTemplateScreen key={id} id={id} />;
  if (kind === "sheet") return <SheetScreen key={id} id={id} />;
  return <DocScreen key={id} id={id} />;
}
