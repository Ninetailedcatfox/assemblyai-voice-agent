"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { SceneObject, SceneSpec } from "@/lib/scene";

function material(color: string) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.12 });
}

function meshForObject(item: SceneObject): THREE.Object3D {
  if (item.kind === "tree") {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.15, 10), material("#8e5e42"));
    trunk.position.y = -0.2;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.78, 1), material(item.color));
    crown.position.y = 0.65;
    group.add(trunk, crown);
    return group;
  }
  if (item.kind === "house") {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1, 1.2), material(item.color));
    body.position.y = -0.2;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.08, 0.85, 4), material("#dc6b65"));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 0.72;
    group.add(body, roof);
    return group;
  }
  if (item.kind === "crystal") {
    return new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.8, 6), material(item.color));
  }
  if (item.kind === "ring") {
    return new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.1, 12, 48), material(item.color));
  }
  const geometry =
    item.kind === "sphere"
      ? new THREE.SphereGeometry(0.85, 24, 16)
      : item.kind === "cylinder"
        ? new THREE.CylinderGeometry(0.65, 0.65, 1.6, 20)
        : item.kind === "cone"
          ? new THREE.ConeGeometry(0.7, 1.7, 20)
          : new THREE.BoxGeometry(1.2, 1.2, 1.2);
  return new THREE.Mesh(geometry, material(item.color));
}

export default function SceneCanvas({ spec }: { spec: SceneSpec }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(spec.palette.background);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(6.8, 4.5, 8.6);
    camera.lookAt(0, 1, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.domElement.className = "h-full w-full cursor-grab active:cursor-grabbing";
    renderer.domElement.setAttribute("aria-label", "可拖拽旋转的 3D 场景预览");
    host.replaceChildren(renderer.domElement);

    const root = new THREE.Group();
    scene.add(root);
    const ambient = new THREE.HemisphereLight("#d7f6ff", spec.palette.ground, 2.1);
    scene.add(ambient);
    const key = new THREE.DirectionalLight("#fff2d0", 3.2);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64), material(spec.palette.ground));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(12, 24, spec.palette.accent, spec.palette.ground);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    scene.add(grid);

    const clickable: THREE.Object3D[] = [];
    spec.objects.forEach((item) => {
      const node = meshForObject(item);
      node.position.set(...item.position);
      node.scale.set(...item.scale);
      node.rotation.set(...item.rotation);
      node.userData.label = item.label;
      node.traverse((child) => {
        child.castShadow = true;
        child.userData.label = item.label;
      });
      root.add(node);
      clickable.push(node);
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let frame = 0;
    const resize = () => {
      const width = Math.max(host.clientWidth, 320);
      const height = Math.max(host.clientHeight, 360);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const down = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      root.rotation.y += (event.clientX - lastX) * 0.008;
      root.rotation.x = THREE.MathUtils.clamp(root.rotation.x + (event.clientY - lastY) * 0.004, -0.45, 0.45);
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const up = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      renderer.domElement.releasePointerCapture(event.pointerId);
    };
    const click = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickable, true)[0];
      setSelected(String(hit?.object.userData.label ?? ""));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("click", click);
    resize();

    const animate = () => {
      frame = requestAnimationFrame(animate);
      root.rotation.y += 0.0018;
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("click", click);
      renderer.dispose();
      scene.traverse((node) => {
        const objectNode = node as THREE.Mesh;
        if (objectNode.geometry) objectNode.geometry.dispose();
        if (objectNode.material) {
          const materials = Array.isArray(objectNode.material) ? objectNode.material : [objectNode.material];
          materials.forEach((entry) => entry.dispose());
        }
      });
    };
  }, [spec]);

  return (
    <div className="relative h-full min-h-[360px] overflow-hidden rounded-2xl border border-white/10 bg-black/20">
      <div ref={hostRef} className="h-full min-h-[360px]" />
      <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/75 backdrop-blur">
        拖拽旋转 · 点击物体
      </div>
      {selected && (
        <div className="absolute bottom-4 left-4 rounded-xl border border-cyan-200/20 bg-slate-950/80 px-3 py-2 text-sm text-cyan-100 backdrop-blur">
          选中：{selected}
        </div>
      )}
    </div>
  );
}
