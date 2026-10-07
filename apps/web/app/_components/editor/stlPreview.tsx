"use client";

import { useEffect, useRef, useState } from "react";

/*
 * Draws an ASCII ```stl block as a 3D model you can orbit with the mouse.
 * three.js is loaded the first time a doc needs it.
 */

const HEIGHT = 320;

type Three = typeof import("three");
type Loaded = {
  three: Three;
  STLLoader: typeof import("three/examples/jsm/loaders/STLLoader.js").STLLoader;
  OrbitControls: typeof import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
};

let load: Promise<Loaded> | null = null;

function loadThree() {
  load ??= Promise.all([
    import("three"),
    import("three/examples/jsm/loaders/STLLoader.js"),
    import("three/examples/jsm/controls/OrbitControls.js"),
  ]).then(([three, loader, controls]) => ({
    three,
    STLLoader: loader.STLLoader,
    OrbitControls: controls.OrbitControls,
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
        const { three, STLLoader, OrbitControls } = await loadThree();
        if (cancelled) return;
        const geometry = new STLLoader().parse(new TextEncoder().encode(source).buffer);
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

        const material = new three.MeshStandardMaterial({ color: 0x8b7cf7, metalness: 0.1, roughness: 0.6 });
        scene.add(new three.Mesh(geometry, material));
        scene.add(new three.HemisphereLight(0xffffff, 0x444466, 1.6));
        const sun = new three.DirectionalLight(0xffffff, 1.4);
        sun.position.set(1, -1, 2).multiplyScalar(sphere.radius * 5);
        scene.add(sun);

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
          material.dispose();
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
