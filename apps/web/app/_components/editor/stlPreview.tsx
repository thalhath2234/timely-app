"use client";

import { useEffect, useRef, useState } from "react";

/*
 * Draws an ASCII ```stl block as a 3D model you can orbit with the mouse.
 * three.js is loaded the first time a doc needs it. Each `solid` in the file
 * is a part; a `#rrggbb` word in its name colors it.
 */

const HEIGHT = 320;
const CREASE_ANGLE = (40 * Math.PI) / 180;

type Three = typeof import("three");
type Loaded = {
  three: Three;
  STLLoader: typeof import("three/examples/jsm/loaders/STLLoader.js").STLLoader;
  OrbitControls: typeof import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
  toCreasedNormals: typeof import("three/examples/jsm/utils/BufferGeometryUtils.js").toCreasedNormals;
};

let load: Promise<Loaded> | null = null;

// Parts without a color of their own. A single part keeps the accent color.
const PART_COLORS = ["#8b7cf7", "#f2b880", "#6fb7e9", "#ef8fa8", "#86cf9f", "#e9cf72", "#b49a85"];

/** Color for one `solid <name> #rrggbb` part of an STL. */
export function partColor(name: string | undefined, index: number, parts: number): string {
  const hex = /(?:^|\s)#([0-9a-f]{6}|[0-9a-f]{3})(?=\s|$)/i.exec(name ?? "");
  if (hex) return `#${hex[1]}`;
  return parts === 1 ? PART_COLORS[0] : PART_COLORS[index % PART_COLORS.length];
}

function loadThree() {
  load ??= Promise.all([
    import("three"),
    import("three/examples/jsm/loaders/STLLoader.js"),
    import("three/examples/jsm/controls/OrbitControls.js"),
    import("three/examples/jsm/utils/BufferGeometryUtils.js"),
  ]).then(([three, loader, controls, utils]) => ({
    three,
    STLLoader: loader.STLLoader,
    OrbitControls: controls.OrbitControls,
    toCreasedNormals: utils.toCreasedNormals,
  }));
  return load;
}

export default function StlPreview({ code }: { code: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const source = code.trim();
    if (!host || !source) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { three, STLLoader, OrbitControls, toCreasedNormals } = await loadThree();
        if (cancelled) return;
        const geometry = new STLLoader().parse(new TextEncoder().encode(source).buffer);
        // Hand-written files often store "facet normal 0 0 0", which draws
        // black, so normals come from the triangles: smooth across gentle
        // bends (round parts), sharp at real edges (boxes).
        toCreasedNormals(geometry, CREASE_ANGLE);
        geometry.computeBoundingSphere();
        const sphere = geometry.boundingSphere;
        if (!sphere || !Number.isFinite(sphere.radius) || sphere.radius === 0) {
          throw new Error("No triangles found in the STL.");
        }
        const width = host.clientWidth || 600;
        const renderer = new three.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, HEIGHT);
        host.replaceChildren(renderer.domElement);

        const scene = new three.Scene();
        const camera = new three.PerspectiveCamera(40, width / HEIGHT, sphere.radius / 100, sphere.radius * 100);
        const distance = sphere.radius / Math.sin((camera.fov * Math.PI) / 360) * 1.2;
        camera.position.set(sphere.center.x + distance * 0.6, sphere.center.y - distance * 0.6, sphere.center.z + distance * 0.5);
        camera.up.set(0, 0, 1);
        camera.lookAt(sphere.center);

        const names: string[] = geometry.userData.groupNames ?? [];
        const colors = (geometry.groups.length ? geometry.groups : [null]).map((_, i, all) =>
          partColor(names[i], i, all.length),
        );
        // Double-sided, so triangles wound the wrong way still light up.
        const materials = colors.map(
          (color) => new three.MeshStandardMaterial({ color, metalness: 0, roughness: 0.65, side: three.DoubleSide }),
        );
        scene.add(new three.Mesh(geometry, materials.length === 1 ? materials[0] : materials));
        scene.add(new three.HemisphereLight(0xffffff, 0x555566, 1.5));
        const sun = new three.DirectionalLight(0xffffff, 1.6);
        sun.position.set(1, -1, 2).multiplyScalar(sphere.radius * 5);
        scene.add(sun);
        const fill = new three.DirectionalLight(0xffffff, 0.6);
        fill.position.set(-1, 1, 0.5).multiplyScalar(sphere.radius * 5);
        scene.add(fill);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.copy(sphere.center);
        controls.enableDamping = false;
        const render = () => renderer.render(scene, camera);
        controls.addEventListener("change", render);
        controls.update();
        render();
        setError(null);
        dispose = () => {
          controls.dispose();
          renderer.dispose();
          geometry.dispose();
          materials.forEach((material) => material.dispose());
          renderer.domElement.remove();
        };
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      dispose?.();
    };
  }, [code]);

  if (!code.trim()) {
    return (
      <div className="doc-mermaid doc-mermaid-empty" contentEditable={false}>
        Paste an ASCII STL above to show the model.
      </div>
    );
  }
  return (
    <div className="doc-mermaid doc-stl" contentEditable={false}>
      <div ref={hostRef} className="doc-stl-canvas" style={{ height: HEIGHT }} />
      {error && <pre className="doc-mermaid-error">{error.split("\n")[0]}</pre>}
    </div>
  );
}
