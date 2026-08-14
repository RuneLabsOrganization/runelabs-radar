'use client';

import * as React from 'react';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const TWO_PI = Math.PI * 2;
const CONTACTS = 380;
const MAX_R = 4.2;

/**
 * The identity, animated: a WebGL radar scope — polar graticule, drifting
 * phosphor contacts, a rotating sweep that lights them up as it passes.
 * Ambient (pointer-events: none), DPR-capped, paused when hidden, static
 * under prefers-reduced-motion.
 */
export default function RadarField({ intensity = 0.15 }: { intensity?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // colors come from the live CSS tokens (theme-aware); THREE.Color parses
    // both hex and rgb()/rgba() styles
    const cssColor = (name: string, fallback: string): THREE.Color => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      try {
        return new THREE.Color(v || fallback);
      } catch {
        return new THREE.Color(fallback);
      }
    };
    const phosphor = cssColor('--phosphor', '#57d9a3');
    const gratColor = cssColor('--grat-strong', '#97b4cd');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 4.4, 6.4);
    camera.lookAt(0, 0, 0);

    // preserveDrawingBuffer keeps the canvas capturable (screenshots, screen
    // shares, e2e tooling) — some capture paths hang on a discarded buffer.
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

    // ── polar graticule: rings + spokes on the XZ plane
    const gratMat = new THREE.LineBasicMaterial({ color: gratColor, transparent: true, opacity: 0.1 });
    disposables.push(gratMat);
    const graticule = new THREE.Group();
    for (let r = 1; r <= 4; r++) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * TWO_PI;
        pts.push(new THREE.Vector3(Math.cos(a) * (r * MAX_R) / 4, 0, Math.sin(a) * (r * MAX_R) / 4));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      disposables.push(g);
      graticule.add(new THREE.Line(g, gratMat));
    }
    for (let s = 0; s < 12; s++) {
      const a = (s / 12) * TWO_PI;
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(Math.cos(a) * MAX_R, 0, Math.sin(a) * MAX_R),
      ]);
      disposables.push(g);
      graticule.add(new THREE.Line(g, gratMat));
    }
    scene.add(graticule);

    // ── contacts: points lit by the sweep via a shader varying
    const positions = new Float32Array(CONTACTS * 3);
    const angles = new Float32Array(CONTACTS);
    const sizes = new Float32Array(CONTACTS);
    for (let i = 0; i < CONTACTS; i++) {
      const a = Math.random() * TWO_PI;
      const r = 0.25 + Math.sqrt(Math.random()) * (MAX_R - 0.3);
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = Math.sin(a) * r;
      angles[i] = Math.atan2(-Math.sin(a) * r, Math.cos(a) * r); // matches sweep angle convention
      sizes[i] = 1.2 + Math.random() * 2.4;
    }
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pointsGeo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
    pointsGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    disposables.push(pointsGeo);

    const pointsMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSweep: { value: 0 },
        uColor: { value: phosphor },
      },
      vertexShader: `
        attribute float aAngle;
        attribute float aSize;
        uniform float uSweep;
        varying float vB;
        void main() {
          float d = mod(uSweep - aAngle, 6.28318);
          vB = 0.14 + exp(-d * 2.1) * 0.95;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (150.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vB;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(c));
          gl_FragColor = vec4(uColor, a * vB);
        }
      `,
    });
    disposables.push(pointsMat);
    scene.add(new THREE.Points(pointsGeo, pointsMat));

    // ── the sweep beam
    const sweepGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.002, 0),
      new THREE.Vector3(MAX_R, 0.002, 0),
    ]);
    const sweepMat = new THREE.LineBasicMaterial({ color: phosphor, transparent: true, opacity: 0.45 });
    disposables.push(sweepGeo, sweepMat);
    const sweep = new THREE.Line(sweepGeo, sweepMat);
    scene.add(sweep);

    // ── sizing, parallax, loop
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

    const mouse = { x: 0, y: 0 };
    const onMouse = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('mousemove', onMouse, { passive: true });

    let raf = 0;
    let sweepAngle = Math.random() * TWO_PI;
    let last = performance.now();
    const renderFrame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      sweepAngle = (sweepAngle + dt * 0.55) % TWO_PI;
      sweep.rotation.y = sweepAngle;
      pointsMat.uniforms.uSweep.value = sweepAngle;
      camera.position.x += (mouse.x * 0.5 - camera.position.x) * 0.03;
      camera.position.y = 4.4 + mouse.y * -0.25;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };
    const loop = (now: number) => {
      renderFrame(now);
      raf = requestAnimationFrame(loop);
    };
    if (reduced) {
      // single static frame — the identity without the motion
      renderFrame(performance.now());
    } else {
      raf = requestAnimationFrame(loop);
    }

    const onVisibility = () => {
      if (reduced) return;
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('mousemove', onMouse);
      ro.disconnect();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ opacity: intensity }}
    />
  );
}
