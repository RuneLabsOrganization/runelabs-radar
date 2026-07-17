'use client';

import * as React from 'react';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TopicMapCluster, TopicMapPoint } from '@/lib/analytics';

const S = 10; // world scale
const MAX_AGE = 14;

export interface HoverInfo {
  title: string;
  clusterLabel: string;
  score: number;
  ageDays: number;
  x: number;
  y: number;
}

/**
 * The semantic starfield: every story a phosphor point placed by embedding
 * PCA (x/y) and age (depth — the field recedes into the past). Orbit to
 * navigate, hover for the story, click to open it, select a cluster to
 * isolate its region.
 */
export default function StarfieldMap({
  clusters,
  points,
  selected,
  onSelect,
  onHover,
}: {
  clusters: TopicMapCluster[];
  points: TopicMapPoint[];
  selected: number | null;
  onSelect: (clusterId: number | null) => void;
  onHover: (info: HoverInfo | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected);
  const applySelectionRef = useRef<(sel: number | null) => void>(() => {});

  useEffect(() => {
    selectedRef.current = selected;
    applySelectionRef.current(selected);
  }, [selected]);

  useEffect(() => {
    const el = ref.current;
    if (!el || points.length === 0) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0e13, S * 1.6, S * 4.2);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    camera.position.set(0, -S * 0.35, S * 1.9);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const disposables: { dispose(): void }[] = [];
    const heatOf = new Map(clusters.map((c) => [c.id, c.heat]));

    // ── points
    const n = points.length;
    const positions = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const alphas = new Float32Array(n);
    points.forEach((p, i) => {
      positions[i * 3] = p.x * S;
      positions[i * 3 + 1] = p.y * S;
      positions[i * 3 + 2] = -(Math.min(p.ageDays, MAX_AGE) / MAX_AGE) * S * 1.1;
      sizes[i] = p.score >= 70 ? 3.2 : p.score >= 40 ? 2.3 : 1.7;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    disposables.push(geo);

    const computeAlphas = (sel: number | null) => {
      points.forEach((p, i) => {
        const heat = heatOf.get(p.clusterId) ?? 0;
        const base = 0.35 + heat * 0.5;
        alphas[i] = sel === null ? base : p.clusterId === sel ? Math.min(1, base + 0.3) : 0.08;
      });
      geo.getAttribute('aAlpha').needsUpdate = true;
    };
    computeAlphas(selectedRef.current);
    applySelectionRef.current = computeAlphas;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0x57d9a3) } },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        varying float vA;
        void main() {
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (140.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.08, length(c));
          gl_FragColor = vec4(uColor, a * vA);
        }
      `,
    });
    disposables.push(mat);
    const cloud = new THREE.Points(geo, mat);
    scene.add(cloud);

    // ── graticule ring at the present (z = 0)
    const ringMat = new THREE.LineBasicMaterial({ color: 0x97b4cd, transparent: true, opacity: 0.12 });
    disposables.push(ringMat);
    for (const r of [S * 1.05, S * 0.55]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      disposables.push(g);
      scene.add(new THREE.Line(g, ringMat));
    }

    // ── cluster labels as HTML overlay
    const labelEls = clusters.map((c) => {
      const div = document.createElement('div');
      div.textContent = c.coherence > 0 && c.coherence < 0.5 ? `${c.label} (mixed)` : c.label;
      div.style.cssText =
        'position:absolute;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;' +
        'font-family:var(--font-readout);font-size:9.5px;letter-spacing:0.08em;text-transform:uppercase;' +
        'white-space:nowrap;user-select:none;';
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelect(selectedRef.current === c.id ? null : c.id);
      });
      el.appendChild(div);
      const members = points.filter((p) => p.clusterId === c.id);
      const mz =
        members.length > 0
          ? members.reduce((a, p) => a - (Math.min(p.ageDays, MAX_AGE) / MAX_AGE) * S * 1.1, 0) / members.length
          : 0;
      return { c, div, world: new THREE.Vector3(c.x * S, c.y * S, mz) };
    });

    const styleLabels = () => {
      for (const { c, div, world } of labelEls) {
        const sel = selectedRef.current;
        const dimmed = sel !== null && sel !== c.id;
        const mixed = c.coherence > 0 && c.coherence < 0.5;
        div.style.color = dimmed ? 'var(--ink-4)' : mixed ? 'var(--ink-4)' : c.heat > 0.7 ? 'var(--ink)' : 'var(--ink-3)';
        div.style.opacity = dimmed ? '0.35' : '1';
        const v = world.clone().project(camera);
        if (v.z > 1 || v.z < -1) {
          div.style.display = 'none';
          continue;
        }
        div.style.display = 'block';
        div.style.left = `${((v.x + 1) / 2) * width}px`;
        div.style.top = `${((1 - v.y) / 2) * height}px`;
      }
    };

    // ── controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = S * 0.5;
    controls.maxDistance = S * 3.6;
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = 0.4;
    const stopAuto = () => {
      controls.autoRotate = false;
    };
    renderer.domElement.addEventListener('pointerdown', stopAuto, { once: true });

    // ── raycasting: hover + click-through
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.22 };
    const pointer = new THREE.Vector2();
    let hoveredIdx: number | null = null;
    let downPos: { x: number; y: number } | null = null;

    const pick = (e: PointerEvent): number | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(cloud);
      // dimmed (non-selected-cluster) points are effectively invisible — they
      // must not steal hover/clicks from the isolated region
      const sel = selectedRef.current;
      for (const hit of hits) {
        if (hit.index === undefined) continue;
        if (sel !== null && points[hit.index].clusterId !== sel) continue;
        return hit.index;
      }
      return null;
    };

    const onMove = (e: PointerEvent) => {
      const idx = pick(e);
      if (idx === hoveredIdx) return;
      hoveredIdx = idx;
      renderer.domElement.style.cursor = idx !== null ? 'pointer' : 'grab';
      if (idx === null) {
        onHover(null);
      } else {
        const p = points[idx];
        const rect = renderer.domElement.getBoundingClientRect();
        onHover({
          title: p.title,
          clusterLabel: clusters.find((c) => c.id === p.clusterId)?.label ?? '',
          score: p.score,
          ageDays: Math.round(p.ageDays),
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }
    };
    const onLeave = () => {
      hoveredIdx = null;
      renderer.domElement.style.cursor = 'grab';
      onHover(null);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // right/middle must not click-through
      downPos = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (moved > 5) return; // drag, not click
      const idx = pick(e);
      if (idx !== null) {
        const p = points[idx];
        if (p.url) window.open(p.url, '_blank', 'noopener');
        else onSelect(selectedRef.current === p.clusterId ? null : p.clusterId);
      }
    };
    renderer.domElement.addEventListener('pointermove', onMove, { passive: true });
    renderer.domElement.addEventListener('pointerleave', onLeave, { passive: true });
    renderer.domElement.addEventListener('pointerdown', onDown, { passive: true });
    renderer.domElement.addEventListener('pointerup', onUp, { passive: true });

    // ── sizing + loop
    let width = 0;
    let height = 0;
    const resize = () => {
      width = el.clientWidth;
      height = el.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let raf = 0;
    const loop = () => {
      controls.update();
      styleLabels();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(loop);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      onHover(null); // no stale tooltip across re-renders
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      ro.disconnect();
      controls.dispose();
      for (const { div } of labelEls) el.removeChild(div);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      applySelectionRef.current = () => {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters, points]);

  return <div ref={ref} className="relative h-full w-full overflow-hidden" style={{ cursor: 'grab' }} />;
}
