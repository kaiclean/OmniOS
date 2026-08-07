'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { BrainGraph, GraphNode } from '@/lib/brain/graph';
import { hash32 } from '@/lib/domain';
import { PERSONAL_HUE, hueForSpaceKey } from '@/lib/ui/space-tint';

/**
 * The workspace as a nervous system, drawn from real records only.
 *
 * Design decisions, because a 3D scene can violate a design language faster
 * than any page:
 *
 * - Hue still belongs to the space. A company's cluster glows in that company's
 *   rail hue; personal life in its amber; shared memory in the neutral OS
 *   violet. The brain is the one screen where the room's tint touches content,
 *   and it is allowed precisely because the hue *is* the data here.
 * - The layout is deterministic. Positions seed from each node's id and relax
 *   through a fixed number of force iterations, so reloading shows the same
 *   brain, and a new record appears as growth — not as a reshuffle.
 * - Everything animated is optional. `reduceMotion` freezes the orbit and the
 *   pulses and leaves a still, readable structure.
 *
 * The synapse pulses travel real edges. A pulse from a task to its capability
 * hub exists because that containment exists; nothing fires along a filament
 * that is not in the data.
 */

const POLL_MS = 6000;

interface Sim {
  readonly ids: string[];
  readonly index: Map<string, number>;
  positions: Float32Array;
  readonly weights: number[];
  readonly hues: number[];
  readonly kinds: string[];
  readonly labels: string[];
  readonly spaceLabels: string[];
  edges: Array<[number, number, string]>;
}

function hueFor(node: GraphNode): number {
  if (node.spaceKey === 'os') return 258;
  if (node.spaceKey === 'shared') return 300;
  if (node.spaceKey === 'personal') return PERSONAL_HUE;
  return hueForSpaceKey(node.spaceKey);
}

/** Seeded unit-ish vector from an id — stable across reloads by construction. */
function seedPosition(id: string, radius: number): [number, number, number] {
  const a = (hash32(id) % 10_000) / 10_000;
  const b = (hash32(`${id}:b`) % 10_000) / 10_000;
  const c = (hash32(`${id}:c`) % 10_000) / 10_000;
  const theta = a * Math.PI * 2;
  const phi = Math.acos(2 * b - 1);
  const r = radius * (0.55 + 0.45 * c);
  return [r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi)];
}

/**
 * A small force relaxation: springs along edges, repulsion between all pairs,
 * gentle centering. Fixed iteration count and seeded starts make it a pure
 * function of the graph. New nodes start from their seed while existing nodes
 * keep their settled positions, so growth reads as growth.
 */
function relax(sim: Sim, iterations: number): void {
  const n = sim.ids.length;
  const pos = sim.positions;
  const vel = new Float32Array(n * 3);

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const dx = pos[i * 3]! - pos[j * 3]!;
        const dy = pos[i * 3 + 1]! - pos[j * 3 + 1]!;
        const dz = pos[i * 3 + 2]! - pos[j * 3 + 2]!;
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        const force = Math.min(2.4, (sim.weights[i]! * sim.weights[j]!) / (d2 * 14));
        const d = Math.sqrt(d2);
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        const fz = (dz / d) * force;
        vel[i * 3] = vel[i * 3]! + fx;
        vel[i * 3 + 1] = vel[i * 3 + 1]! + fy;
        vel[i * 3 + 2] = vel[i * 3 + 2]! + fz;
        vel[j * 3] = vel[j * 3]! - fx;
        vel[j * 3 + 1] = vel[j * 3 + 1]! - fy;
        vel[j * 3 + 2] = vel[j * 3 + 2]! - fz;
      }
    }
    for (const [a, b] of sim.edges) {
      const dx = pos[b * 3]! - pos[a * 3]!;
      const dy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
      const dz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.001;
      const stretch = (d - 7) * 0.045;
      vel[a * 3] = vel[a * 3]! + (dx / d) * stretch;
      vel[a * 3 + 1] = vel[a * 3 + 1]! + (dy / d) * stretch;
      vel[a * 3 + 2] = vel[a * 3 + 2]! + (dz / d) * stretch;
      vel[b * 3] = vel[b * 3]! - (dx / d) * stretch;
      vel[b * 3 + 1] = vel[b * 3 + 1]! - (dy / d) * stretch;
      vel[b * 3 + 2] = vel[b * 3 + 2]! - (dz / d) * stretch;
    }
    for (let i = 0; i < n; i += 1) {
      vel[i * 3] = vel[i * 3]! - pos[i * 3]! * 0.004;
      vel[i * 3 + 1] = vel[i * 3 + 1]! - pos[i * 3 + 1]! * 0.004;
      vel[i * 3 + 2] = vel[i * 3 + 2]! - pos[i * 3 + 2]! * 0.004;
      pos[i * 3] = pos[i * 3]! + vel[i * 3]! * 0.5;
      pos[i * 3 + 1] = pos[i * 3 + 1]! + vel[i * 3 + 1]! * 0.5;
      pos[i * 3 + 2] = pos[i * 3 + 2]! + vel[i * 3 + 2]! * 0.5;
      vel[i * 3] = vel[i * 3]! * 0.72;
      vel[i * 3 + 1] = vel[i * 3 + 1]! * 0.72;
      vel[i * 3 + 2] = vel[i * 3 + 2]! * 0.72;
    }
  }
}

function buildSim(graph: BrainGraph, previous: Sim | null): Sim {
  const ids = graph.nodes.map((node) => node.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const positions = new Float32Array(ids.length * 3);

  graph.nodes.forEach((node, i) => {
    const prior = previous?.index.get(node.id);
    if (previous && prior !== undefined) {
      positions[i * 3] = previous.positions[prior * 3]!;
      positions[i * 3 + 1] = previous.positions[prior * 3 + 1]!;
      positions[i * 3 + 2] = previous.positions[prior * 3 + 2]!;
    } else {
      const anchor = node.kind === 'core' ? [0, 0, 0] : seedPosition(node.id, node.kind === 'space' ? 16 : 30);
      positions[i * 3] = anchor[0]!;
      positions[i * 3 + 1] = anchor[1]!;
      positions[i * 3 + 2] = anchor[2]!;
    }
  });

  const sim: Sim = {
    ids,
    index,
    positions,
    weights: graph.nodes.map((node) => node.weight),
    hues: graph.nodes.map(hueFor),
    kinds: graph.nodes.map((node) => node.kind),
    labels: graph.nodes.map((node) => node.label),
    spaceLabels: graph.nodes.map((node) => node.spaceKey),
    edges: graph.edges
      .map((edge): [number, number, string] | null => {
        const a = index.get(edge.from);
        const b = index.get(edge.to);
        return a === undefined || b === undefined ? null : [a, b, edge.kind];
      })
      .filter((edge): edge is [number, number, string] => edge !== null),
  };

  relax(sim, previous ? 40 : 120);
  return sim;
}

/** A soft radial glow sprite, drawn once — additive blending does the rest. */
function glowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export interface BrainGraphProps {
  readonly initial: BrainGraph;
  readonly reduceMotion: boolean;
}

export function BrainGraphView({ initial, reduceMotion }: BrainGraphProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Sim | null>(null);
  const graphRef = useRef<BrainGraph>(initial);
  const bornRef = useRef<Map<string, number>>(new Map());
  const [hover, setHover] = useState<{ label: string; kind: string; space: string } | null>(null);
  const [stats, setStats] = useState({ nodes: initial.nodes.length, edges: initial.edges.length, total: initial.totalRecords });
  const [fullscreen, setFullscreen] = useState(false);
  const [live, setLive] = useState(true);

  const applyGraph = useCallback((graph: BrainGraph) => {
    graphRef.current = graph;
    setStats({ nodes: graph.nodes.length, edges: graph.edges.length, total: graph.totalRecords });
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05060a, 0.012);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    camera.position.set(0, 10, 62);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setClearColor(0x05060a, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.55;
    controls.minDistance = 18;
    controls.maxDistance = 140;

    const sprite = glowTexture();

    // Nodes: two layers of the same points — a tight core and a wide halo.
    const nodeGeometry = new THREE.BufferGeometry();
    const coreMaterial = new THREE.PointsMaterial({
      size: 2.4,
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const haloMaterial = new THREE.PointsMaterial({
      size: 7,
      map: sprite,
      vertexColors: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const corePoints = new THREE.Points(nodeGeometry, coreMaterial);
    const haloPoints = new THREE.Points(nodeGeometry, haloMaterial);
    scene.add(haloPoints, corePoints);

    const edgeGeometry = new THREE.BufferGeometry();
    const edgeMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    scene.add(lines);

    // Pulses: a fixed pool of particles travelling along real edges.
    const PULSES = reduceMotion ? 0 : 90;
    const pulseGeometry = new THREE.BufferGeometry();
    const pulsePositions = new Float32Array(Math.max(PULSES, 1) * 3);
    const pulseColors = new Float32Array(Math.max(PULSES, 1) * 3);
    pulseGeometry.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3));
    pulseGeometry.setAttribute('color', new THREE.BufferAttribute(pulseColors, 3));
    const pulseMaterial = new THREE.PointsMaterial({
      size: 1.7,
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pulsePoints = new THREE.Points(pulseGeometry, pulseMaterial);
    if (PULSES > 0) scene.add(pulsePoints);
    const pulseState = Array.from({ length: PULSES }, (_, i) => ({ edge: i, t: (i * 37) % 100 / 100, speed: 0.2 + ((i * 13) % 10) / 18 }));

    const color = new THREE.Color();

    const rebuild = () => {
      const previous = simRef.current;
      const sim = buildSim(graphRef.current, previous);
      simRef.current = sim;

      const now = performance.now();
      for (const id of sim.ids) if (!bornRef.current.has(id)) bornRef.current.set(id, previous ? now : 0);

      const n = sim.ids.length;
      const colors = new Float32Array(n * 3);
      const sizes: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const lightness = sim.kinds[i] === 'core' ? 0.9 : sim.kinds[i] === 'space' ? 0.72 : 0.58;
        color.setHSL((sim.hues[i]! % 360) / 360, 0.62, lightness);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
        sizes.push(sim.weights[i]!);
      }
      nodeGeometry.setAttribute('position', new THREE.BufferAttribute(sim.positions, 3));
      nodeGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      nodeGeometry.computeBoundingSphere();

      const edgePositions = new Float32Array(sim.edges.length * 6);
      const edgeColors = new Float32Array(sim.edges.length * 6);
      sim.edges.forEach(([a, b, kind], i) => {
        edgePositions.set(sim.positions.slice(a * 3, a * 3 + 3), i * 6);
        edgePositions.set(sim.positions.slice(b * 3, b * 3 + 3), i * 6 + 3);
        const bright = kind === 'bridge' || kind === 'link' ? 0.62 : 0.3;
        color.setHSL((sim.hues[a]! % 360) / 360, 0.55, bright);
        edgeColors.set([color.r, color.g, color.b], i * 6);
        color.setHSL((sim.hues[b]! % 360) / 360, 0.55, bright);
        edgeColors.set([color.r, color.g, color.b], i * 6 + 3);
      });
      edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
      edgeGeometry.setAttribute('color', new THREE.BufferAttribute(edgeColors, 3));
      edgeGeometry.computeBoundingSphere();
    };

    rebuild();

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 1.4 };
    const pointer = new THREE.Vector2();
    const onPointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(corePoints, false)[0];
      const sim = simRef.current;
      if (hit?.index !== undefined && sim) {
        const i = hit.index;
        setHover({
          label: sim.labels[i] ?? '',
          kind: sim.kinds[i] ?? '',
          space: sim.spaceLabels[i] ?? '',
        });
      } else {
        setHover(null);
      }
    };
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let raf = 0;
    let lastPoll = performance.now();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();

      const sim = simRef.current;
      if (sim && PULSES > 0 && sim.edges.length > 0) {
        for (let i = 0; i < PULSES; i += 1) {
          const state = pulseState[i]!;
          state.t += state.speed * 0.008;
          if (state.t >= 1) {
            state.t = 0;
            state.edge = (state.edge + 7) % sim.edges.length;
          }
          const [a, b] = sim.edges[state.edge % sim.edges.length]!;
          const t = state.t;
          pulsePositions[i * 3] = sim.positions[a * 3]! + (sim.positions[b * 3]! - sim.positions[a * 3]!) * t;
          pulsePositions[i * 3 + 1] = sim.positions[a * 3 + 1]! + (sim.positions[b * 3 + 1]! - sim.positions[a * 3 + 1]!) * t;
          pulsePositions[i * 3 + 2] = sim.positions[a * 3 + 2]! + (sim.positions[b * 3 + 2]! - sim.positions[a * 3 + 2]!) * t;
          color.setHSL((sim.hues[a]! % 360) / 360, 0.7, 0.8);
          pulseColors[i * 3] = color.r;
          pulseColors[i * 3 + 1] = color.g;
          pulseColors[i * 3 + 2] = color.b;
        }
        pulseGeometry.attributes['position']!.needsUpdate = true;
        pulseGeometry.attributes['color']!.needsUpdate = true;
      }

      renderer.render(scene, camera);

      if (live && performance.now() - lastPoll > POLL_MS) {
        lastPoll = performance.now();
        void fetch('/api/brain-graph', { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((graph: BrainGraph | null) => {
            if (!graph) return;
            const grew =
              graph.nodes.length !== graphRef.current.nodes.length ||
              graph.edges.length !== graphRef.current.edges.length;
            applyGraph(graph);
            if (grew) rebuild();
          })
          .catch(() => undefined);
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      controls.dispose();
      nodeGeometry.dispose();
      edgeGeometry.dispose();
      pulseGeometry.dispose();
      coreMaterial.dispose();
      haloMaterial.dispose();
      edgeMaterial.dispose();
      pulseMaterial.dispose();
      sprite.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // The scene rebuilds only when motion or liveness change; graph updates
    // flow through refs + rebuild() without touching the WebGL context.
  }, [reduceMotion, live, applyGraph]);

  return (
    <div className="brain-graph" data-fullscreen={fullscreen ? 'true' : 'false'}>
      <div className="brain-graph-canvas" ref={mountRef} />

      <div className="brain-graph-hud">
        <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
          <span className="badge badge--outline">{stats.nodes} neurons</span>
          <span className="badge badge--outline">{stats.edges} synapses</span>
          <span className="badge badge--outline">{stats.total} records observed</span>
          <span className="badge badge--outline" data-live={live}>
            {live ? 'Live · watching your workspace' : 'Paused'}
          </span>
        </div>
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setLive((v) => !v)}>
            {live ? 'Pause' : 'Resume'}
          </button>
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            onClick={() => setFullscreen((v) => !v)}
          >
            {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        </div>
      </div>

      {hover ? (
        <div className="brain-graph-tip" role="status">
          <span className="mono">{hover.kind}</span>
          <strong>{hover.label}</strong>
          <span className="faint">{hover.space}</span>
        </div>
      ) : null}
    </div>
  );
}
