"use client";

import { useMemo } from "react";
import { feature } from "topojson-client";
import type { GeometryObject, Topology } from "topojson-specification";

/*
 * Draws a ```geojson or ```topojson block as an outline map: the shapes on
 * a plain background, no street tiles, so it works offline and in the
 * desktop app. GitHub draws the same data over a street map.
 */

type Position = number[];
type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "MultiPoint"; coordinates: Position[] }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "GeometryCollection"; geometries: Geometry[] };
type Feature = { type: "Feature"; geometry: Geometry | null };
type GeoJSON = Geometry | Feature | { type: "FeatureCollection"; features: Feature[] };

const WIDTH = 640;
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 480;
const PADDING = 16;

/** Every geometry in a GeoJSON or TopoJSON value. */
export function geometriesOf(value: unknown): Geometry[] {
  if (!value || typeof value !== "object") return [];
  const data = value as { type?: string };
  if (data.type === "Topology") {
    const topology = value as Topology;
    return Object.values(topology.objects).flatMap((object) =>
      geometriesOf(feature(topology, object as GeometryObject)),
    );
  }
  const geo = value as GeoJSON;
  switch (geo.type) {
    case "FeatureCollection":
      return (geo.features ?? []).flatMap((item) => geometriesOf(item));
    case "Feature":
      return geo.geometry ? geometriesOf(geo.geometry) : [];
    case "GeometryCollection":
      return (geo.geometries ?? []).flatMap((item) => geometriesOf(item));
    case "Point":
    case "MultiPoint":
    case "LineString":
    case "MultiLineString":
    case "Polygon":
    case "MultiPolygon":
      return [geo];
    default:
      return [];
  }
}

/** Web Mercator in degrees-ish units; latitude is clamped near the poles. */
function project([lon, lat]: Position): [number, number] {
  const phi = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return [lon, (-Math.log(Math.tan(Math.PI / 4 + phi / 2)) * 180) / Math.PI];
}

function positionsOf(geometry: Geometry): Position[] {
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates];
    case "MultiPoint":
    case "LineString":
      return geometry.coordinates;
    case "MultiLineString":
    case "Polygon":
      return geometry.coordinates.flat();
    case "MultiPolygon":
      return geometry.coordinates.flat(2);
    case "GeometryCollection":
      return geometry.geometries.flatMap(positionsOf);
  }
}

interface Drawn {
  width: number;
  height: number;
  polygons: string[];
  lines: string[];
  points: [number, number][];
}

/** Scales the shapes into a canvas that keeps their aspect ratio. */
export function drawGeometries(geometries: Geometry[]): Drawn | null {
  const all = geometries.flatMap(positionsOf).filter((p) => Array.isArray(p) && p.length >= 2);
  if (all.length === 0) return null;
  const projected = all.map(project);
  const xs = projected.map((p) => p[0]);
  const ys = projected.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const inner = WIDTH - PADDING * 2;
  let height = Math.round((inner * spanY) / spanX) + PADDING * 2;
  height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height));
  const scale = Math.min(inner / spanX, (height - PADDING * 2) / spanY);
  const offsetX = (WIDTH - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const to = (position: Position): [number, number] => {
    const [x, y] = project(position);
    return [offsetX + (x - minX) * scale, offsetY + (y - minY) * scale];
  };
  const path = (ring: Position[]) =>
    ring.map((position, index) => `${index ? "L" : "M"}${to(position).map((n) => n.toFixed(1)).join(" ")}`).join("");

  const drawn: Drawn = { width: WIDTH, height, polygons: [], lines: [], points: [] };
  const draw = (geometry: Geometry) => {
    switch (geometry.type) {
      case "Point":
        drawn.points.push(to(geometry.coordinates));
        break;
      case "MultiPoint":
        geometry.coordinates.forEach((position) => drawn.points.push(to(position)));
        break;
      case "LineString":
        drawn.lines.push(path(geometry.coordinates));
        break;
      case "MultiLineString":
        geometry.coordinates.forEach((line) => drawn.lines.push(path(line)));
        break;
      case "Polygon":
        drawn.polygons.push(geometry.coordinates.map((ring) => `${path(ring)}Z`).join(""));
        break;
      case "MultiPolygon":
        geometry.coordinates.forEach((polygon) =>
          drawn.polygons.push(polygon.map((ring) => `${path(ring)}Z`).join("")),
        );
        break;
      case "GeometryCollection":
        geometry.geometries.forEach(draw);
        break;
    }
  };
  geometries.forEach(draw);
  return drawn;
}

export default function MapPreview({ code }: { code: string }) {
  const result = useMemo(() => {
    const source = code.trim();
    if (!source) return { error: null, drawn: null };
    try {
      const drawn = drawGeometries(geometriesOf(JSON.parse(source)));
      return { error: drawn ? null : "No coordinates to draw.", drawn };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), drawn: null };
    }
  }, [code]);

  if (!code.trim()) {
    return (
      <div className="doc-mermaid doc-mermaid-empty" contentEditable={false}>
        Paste GeoJSON or TopoJSON above to draw it.
      </div>
    );
  }
  const { drawn, error } = result;
  return (
    <div className="doc-mermaid doc-map" contentEditable={false}>
      {drawn && (
        <svg
          className="doc-map-svg"
          viewBox={`0 0 ${drawn.width} ${drawn.height}`}
          role="img"
          aria-label="Map"
        >
          {drawn.polygons.map((d, index) => (
            <path key={`p${index}`} d={d} className="doc-map-polygon" fillRule="evenodd" />
          ))}
          {drawn.lines.map((d, index) => (
            <path key={`l${index}`} d={d} className="doc-map-line" />
          ))}
          {drawn.points.map(([x, y], index) => (
            <circle key={`c${index}`} cx={x} cy={y} r={4} className="doc-map-point" />
          ))}
        </svg>
      )}
      {error && <pre className="doc-mermaid-error">{error.split("\n")[0]}</pre>}
    </div>
  );
}
