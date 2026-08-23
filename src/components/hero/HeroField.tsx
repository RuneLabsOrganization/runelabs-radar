'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * The product story as one WebGL loop: a dense field of contacts (the raw AI
 * field) is swept by a phosphor beam, a few contacts LOCK (curation), each
 * lock grows a trace to the hub node (MCP), and the hub emits packets to the
 * agent. Noise, then signal, then handoff.
 */

const TWO_PI = Math.PI * 2;
const CONTACTS = 3600;
const MAX_R = 4.2;
const HUB = new THREE.Vector3(MAX_R + 1.0, 0.34, 0);
/** Concurrent locks. Each owns a reticle, a trace and a packet. */
const LOCKS = 5;
const TRACE_SEGMENTS = 26;
const SWEEP_SPAN = 0.62;
const SWEEP_SPEED = 0.72;

interface Lock {
  active: boolean;
  /** contact index this lock is tracking */
  index: number;
  /** seconds since acquisition */
  age: number;
  life: number;
  curve: THREE.QuadraticBezierCurve3;
  reticle: THREE.LineLoop;
  trace: THREE.Line;
  traceMat: THREE.LineBasicMaterial;
  reticleMat: THREE.LineBasicMaterial;
}

function readColor(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try {
    return new THREE.Color(v || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

/** Light theme can't take additive blending — the phosphor washes out to white. */
function isLightTheme(): boolean {
  const bg = readColor('--scope-0', '#0a0e13');
  return bg.r * 0.299 + bg.g * 0.587 + bg.b * 0.114 > 0.5;
}

function ringGeometry(radius: number, segments = 48): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TWO_PI;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

export default function HeroField({ intensity = 1 }: { intensity?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const phosphor = readColor('--phosphor', '#57d9a3');
    const grat = readColor('--grat-strong', '#97b4cd');
    const amber = readColor('--amber', '#d9a13f');
    const light = isLightTheme();
    const blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    /** the light theme needs everything pulled down or it turns to mush */
    const tone = light ? 0.55 : 1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      return; // no WebGL — the CSS canvas stays the backdrop
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const disposables: { dispose(): void }[] = [];
    const track = <T extends { dispose(): void }>(d: T): T => {
      disposables.push(d);
      return d;
    };

    // ── graticule: rings + spokes on the scope plane
    const gratMat = track(
      new THREE.LineBasicMaterial({ color: grat, transparent: true, opacity: 0.45 * tone }),
    );
    for (let r = 1; r <= 4; r++) {
      scene.add(new THREE.LineLoop(track(ringGeometry((r * MAX_R) / 4, 96)), gratMat));
    }
    for (let s = 0; s < 16; s++) {
      const a = (s / 16) * TWO_PI;
      const g = track(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(Math.cos(a) * MAX_R, 0, Math.sin(a) * MAX_R),
        ]),
      );
      scene.add(new THREE.Line(g, gratMat));
    }

    // ── contacts. Angular drift lives in the shader so the sweep math stays
    // exact; the same formula is mirrored in JS to place locks.
    const baseAngle = new Float32Array(CONTACTS);
    const radius = new Float32Array(CONTACTS);
    const seed = new Float32Array(CONTACTS);
    const positions = new Float32Array(CONTACTS * 3);
    const sizes = new Float32Array(CONTACTS);
    for (let i = 0; i < CONTACTS; i++) {
      const a = Math.random() * TWO_PI;
      const r = 0.3 + Math.sqrt(Math.random()) * (MAX_R - 0.35);
      baseAngle[i] = a;
      radius[i] = r;
      seed[i] = Math.random();
      sizes[i] = 0.9 + Math.random() * 1.8;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const driftRate = (i: number) => 0.012 + seed[i] * 0.022;
    const angleAt = (i: number, t: number) => baseAngle[i] + t * driftRate(i);
    const contactPos = (i: number, t: number, out: THREE.Vector3) => {
      const a = angleAt(i, t);
      return out.set(
        Math.cos(a) * radius[i],
        Math.sin(t * 0.6 + seed[i] * TWO_PI) * 0.06,
        Math.sin(a) * radius[i],
      );
    };

    const contactGeo = track(new THREE.BufferGeometry());
    contactGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    contactGeo.setAttribute('aAngle', new THREE.BufferAttribute(baseAngle, 1));
    contactGeo.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
    contactGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    contactGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const contactMat = track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending,
        uniforms: {
          uSweep: { value: 0 },
          uTime: { value: 0 },
          uColor: { value: phosphor },
          uTone: { value: tone },
          uDpr: { value: renderer.getPixelRatio() },
        },
        // gl_PointSize is in device pixels, so the DPR has to be folded in or
        // the field turns into one saturated blob on retina displays
        vertexShader: `
          attribute float aAngle;
          attribute float aRadius;
          attribute float aSeed;
          attribute float aSize;
          uniform float uSweep;
          uniform float uTime;
          uniform float uDpr;
          varying float vB;
          void main() {
            float ang = aAngle + uTime * (0.012 + aSeed * 0.022);
            vec3 p = vec3(cos(ang) * aRadius, sin(uTime * 0.6 + aSeed * 6.28318) * 0.06, sin(ang) * aRadius);
            float d = mod(uSweep - ang, 6.28318);
            float lit = exp(-d * 0.95);
            vB = 0.18 + lit * 0.92;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = aSize * (1.0 + lit * 1.4) * uDpr * (17.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uTone;
          varying float vB;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float a = smoothstep(0.5, 0.08, length(c));
            gl_FragColor = vec4(uColor, a * vB * uTone);
          }
        `,
      }),
    );
    scene.add(new THREE.Points(contactGeo, contactMat));

    // ── sweep wedge: leading edge at local +X, alpha trailing off behind it
    const wedgeVerts: number[] = [0, 0.004, 0];
    const wedgeAlpha: number[] = [0.5];
    for (let i = 0; i <= 26; i++) {
      const b = -(i / 26) * SWEEP_SPAN;
      wedgeVerts.push(Math.cos(b) * MAX_R, 0.004, Math.sin(b) * MAX_R);
      wedgeAlpha.push(Math.pow(1 - i / 26, 2.2));
    }
    const wedgeIdx: number[] = [];
    for (let i = 1; i <= 26; i++) wedgeIdx.push(0, i, i + 1);
    const wedgeGeo = track(new THREE.BufferGeometry());
    wedgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(wedgeVerts, 3));
    wedgeGeo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(wedgeAlpha, 1));
    wedgeGeo.setIndex(wedgeIdx);
    const wedgeMat = track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending,
        uniforms: { uColor: { value: phosphor }, uTone: { value: tone } },
        vertexShader: `
          attribute float aAlpha;
          varying float vA;
          void main() {
            vA = aAlpha;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uTone;
          varying float vA;
          void main() { gl_FragColor = vec4(uColor, vA * 0.26 * uTone); }
        `,
      }),
    );
    const wedge = new THREE.Mesh(wedgeGeo, wedgeMat);
    scene.add(wedge);

    const edgeGeo = track(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.006, 0),
        new THREE.Vector3(MAX_R, 0.006, 0),
      ]),
    );
    const edgeMat = track(
      new THREE.LineBasicMaterial({ color: phosphor, transparent: true, opacity: 0.5 * tone }),
    );
    const edge = new THREE.Line(edgeGeo, edgeMat);
    scene.add(edge);

    // ── hub: where every locked signal is handed to the agent
    const hubGeo = track(new THREE.BufferGeometry());
    hubGeo.setAttribute('position', new THREE.Float32BufferAttribute([HUB.x, HUB.y, HUB.z], 3));
    const hubMat = track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending,
        uniforms: {
          uColor: { value: phosphor },
          uPulse: { value: 0 },
          uTone: { value: tone },
          uDpr: { value: renderer.getPixelRatio() },
        },
        vertexShader: `
          uniform float uPulse;
          uniform float uDpr;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = (46.0 + uPulse * 20.0) * uDpr * (7.6 / -mv.z);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uPulse;
          uniform float uTone;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float core = smoothstep(0.12, 0.02, d);
            float halo = smoothstep(0.5, 0.1, d) * (0.16 + uPulse * 0.26);
            gl_FragColor = vec4(uColor, (core + halo) * uTone);
          }
        `,
      }),
    );
    scene.add(new THREE.Points(hubGeo, hubMat));

    const hubRings = [0, 1, 2].map((i) => {
      const mat = track(new THREE.LineBasicMaterial({ color: phosphor, transparent: true, opacity: 0 }));
      const ring = new THREE.LineLoop(track(ringGeometry(1, 64)), mat);
      ring.position.copy(HUB);
      ring.userData.phase = i / 3;
      scene.add(ring);
      return { ring, mat };
    });

    // ── locks: reticle + trace, pooled
    const locks: Lock[] = [];
    for (let i = 0; i < LOCKS; i++) {
      const reticleMat = track(new THREE.LineBasicMaterial({ color: phosphor, transparent: true, opacity: 0 }));
      const reticle = new THREE.LineLoop(track(ringGeometry(0.3, 4)), reticleMat);
      reticle.rotation.y = Math.PI / 4;
      reticle.visible = false;
      scene.add(reticle);

      const traceMat = track(new THREE.LineBasicMaterial({ color: phosphor, transparent: true, opacity: 0 }));
      const traceGeo = track(new THREE.BufferGeometry());
      traceGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array((TRACE_SEGMENTS + 1) * 3), 3),
      );
      const trace = new THREE.Line(traceGeo, traceMat);
      trace.frustumCulled = false;
      trace.visible = false;
      scene.add(trace);

      locks.push({
        active: false,
        index: 0,
        age: 0,
        life: 0,
        curve: new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), HUB.clone()),
        reticle,
        trace,
        traceMat,
        reticleMat,
      });
    }

    // packets riding the traces into the hub
    const packetPos = new Float32Array(LOCKS * 3);
    const packetAlpha = new Float32Array(LOCKS);
    const packetGeo = track(new THREE.BufferGeometry());
    packetGeo.setAttribute('position', new THREE.BufferAttribute(packetPos, 3));
    packetGeo.setAttribute('aAlpha', new THREE.BufferAttribute(packetAlpha, 1));
    const packetMat = track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending,
        uniforms: {
          uColor: { value: light ? phosphor : amber },
          uTone: { value: tone },
          uDpr: { value: renderer.getPixelRatio() },
        },
        vertexShader: `
          attribute float aAlpha;
          uniform float uDpr;
          varying float vA;
          void main() {
            vA = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = 5.0 * uDpr * (7.6 / -mv.z);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uTone;
          varying float vA;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            gl_FragColor = vec4(uColor, smoothstep(0.5, 0.05, d) * vA * uTone);
          }
        `,
      }),
    );
    scene.add(new THREE.Points(packetGeo, packetMat));

    const tmp = new THREE.Vector3();

    const acquire = (lock: Lock, t: number, sweepAngle: number) => {
      // pick a contact the beam just crossed, biased to the outer rings so the
      // trace has somewhere to travel
      let best = -1;
      let bestScore = Infinity;
      for (let n = 0; n < 40; n++) {
        const i = (Math.random() * CONTACTS) | 0;
        const d = ((sweepAngle - angleAt(i, t)) % TWO_PI + TWO_PI) % TWO_PI;
        const score = d + Math.max(0, 2.6 - radius[i]);
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best < 0) return;
      lock.active = true;
      lock.index = best;
      lock.age = 0;
      lock.life = 3.4 + Math.random() * 1.4;
      lock.reticle.visible = true;
      lock.trace.visible = true;
    };

    const updateLock = (lock: Lock, dt: number, t: number) => {
      lock.age += dt;
      const p = lock.age / lock.life;
      if (p >= 1) {
        lock.active = false;
        lock.reticle.visible = false;
        lock.trace.visible = false;
        return;
      }

      contactPos(lock.index, t, tmp);
      lock.reticle.position.copy(tmp);

      // 0–0.22 acquire, 0.22–0.6 trace grows, then hold and fade
      const acquirePhase = Math.min(1, p / 0.22);
      const fade = p > 0.82 ? 1 - (p - 0.82) / 0.18 : 1;
      const ease = 1 - Math.pow(1 - acquirePhase, 3);
      lock.reticle.scale.setScalar(2.6 - ease * 1.6);
      lock.reticle.rotation.y = Math.PI / 4 + lock.age * 0.7;
      lock.reticleMat.opacity = ease * fade * 0.85 * tone;

      const grow = THREE.MathUtils.clamp((p - 0.22) / 0.38, 0, 1);
      lock.traceMat.opacity = grow * fade * 0.62 * tone;
      if (grow > 0) {
        lock.curve.v0.copy(tmp);
        lock.curve.v1.set(
          (tmp.x + HUB.x) / 2,
          Math.max(tmp.y, HUB.y) + 1.15 + tmp.distanceTo(HUB) * 0.1,
          (tmp.z + HUB.z) / 2,
        );
        const arr = lock.trace.geometry.getAttribute('position') as THREE.BufferAttribute;
        const shown = Math.max(2, Math.round(grow * TRACE_SEGMENTS) + 1);
        for (let s = 0; s <= TRACE_SEGMENTS; s++) {
          const at = lock.curve.getPoint(Math.min(s, shown - 1) / TRACE_SEGMENTS);
          arr.setXYZ(s, at.x, at.y, at.z);
        }
        arr.needsUpdate = true;
        lock.trace.geometry.setDrawRange(0, shown);
      }
    };

    // ── sizing, parallax, loop
    const baseY = 4.2;
    const lookAt = new THREE.Vector3(0.9, 0.55, 0.1);
    let width = 0;
    let height = 0;
    const resize = () => {
      width = el.clientWidth;
      height = el.clientHeight;
      if (width === 0 || height === 0) return;
      const aspect = width / height;
      camera.aspect = aspect;
      // pull back on narrower viewports so the hub stays inside the frame
      camera.position.z = 7.9 * Math.max(1, 1.8 / aspect);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    camera.position.set(0.9, baseY, 7.9);
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
    let t = 0;
    let sweepAngle = 0;
    let nextLock = 0.4;
    let last = performance.now();

    const frame = (dt: number) => {
      t += dt;
      sweepAngle = (sweepAngle + dt * SWEEP_SPEED) % TWO_PI;

      contactMat.uniforms.uSweep.value = sweepAngle;
      contactMat.uniforms.uTime.value = t;
      wedge.rotation.y = -sweepAngle;
      edge.rotation.y = -sweepAngle;

      nextLock -= dt;
      if (nextLock <= 0) {
        const free = locks.find((l) => !l.active);
        if (free) acquire(free, t, sweepAngle);
        nextLock = 1.1 + Math.random() * 1.2;
      }

      let arrivals = 0;
      for (let i = 0; i < locks.length; i++) {
        const lock = locks[i];
        if (!lock.active) {
          packetAlpha[i] = 0;
          continue;
        }
        updateLock(lock, dt, t);
        const p = lock.age / lock.life;
        // packet rides the finished trace, then lands
        const ride = THREE.MathUtils.clamp((p - 0.55) / 0.3, 0, 1);
        if (ride > 0 && ride < 1) {
          const at = lock.curve.getPoint(ride);
          packetPos[i * 3] = at.x;
          packetPos[i * 3 + 1] = at.y;
          packetPos[i * 3 + 2] = at.z;
          packetAlpha[i] = Math.sin(ride * Math.PI) * 1.1;
        } else {
          packetAlpha[i] = 0;
          if (ride >= 1 && p < 0.9) arrivals += 1;
        }
      }
      (packetGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (packetGeo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;

      const pulse = 0.35 + Math.sin(t * 2.1) * 0.12 + Math.min(0.5, arrivals * 0.16);
      hubMat.uniforms.uPulse.value = pulse;
      for (const { ring, mat } of hubRings) {
        const phase = (t * 0.42 + (ring.userData.phase as number)) % 1;
        ring.scale.setScalar(0.28 + phase * 1.5);
        mat.opacity = (1 - phase) * 0.24 * tone;
      }

      camera.position.x += (0.9 + mouse.x * 0.55 - camera.position.x) * 0.035;
      camera.position.y += (baseY + mouse.y * -0.42 - camera.position.y) * 0.035;
      camera.lookAt(lookAt);
      renderer.render(scene, camera);
    };

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frame(dt);
      raf = requestAnimationFrame(step);
    };

    // stop rendering when hidden or scrolled away — this is a hero, not a tax
    let onscreen = true;
    const sync = () => {
      if (reduced) return;
      cancelAnimationFrame(raf);
      if (onscreen && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(step);
      }
    };

    if (reduced) {
      // one composed still: the identity, without the motion
      for (let i = 0; i < 3; i++) {
        acquire(locks[i], 2, 1.2);
        locks[i].age = locks[i].life * (0.45 + i * 0.12);
      }
      frame(0.016);
    } else {
      raf = requestAnimationFrame(step);
    }

    const io = new IntersectionObserver(([entry]) => {
      onscreen = entry.isIntersecting;
      sync();
    });
    io.observe(el);

    const onVisibility = sync;
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('mousemove', onMouse);
      ro.disconnect();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
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
