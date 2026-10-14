import * as THREE from "three";
import { foliageSurface, surface } from "./textures";

export interface MatKit {
  wallA: THREE.MeshStandardMaterial;
  floorA: THREE.MeshStandardMaterial;
  ceilA: THREE.MeshStandardMaterial;
  wallB: THREE.MeshStandardMaterial;
  floorB: THREE.MeshStandardMaterial;
  wallD: THREE.MeshStandardMaterial;
  floorD: THREE.MeshStandardMaterial;
  wallE: THREE.MeshStandardMaterial;
  floorE: THREE.MeshStandardMaterial;
  ceilE: THREE.MeshStandardMaterial;
  soil: THREE.MeshStandardMaterial;
  hedgeSide: THREE.MeshStandardMaterial;
  hedgeCore: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  rust: THREE.MeshStandardMaterial;
  painted: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  lampGlass: THREE.MeshStandardMaterial;
  lampGlassOff: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  concreteProp: THREE.MeshStandardMaterial;
  paper: THREE.MeshStandardMaterial;
  screen: THREE.MeshStandardMaterial;
  dirt: THREE.MeshStandardMaterial;
}

let kit: MatKit | null = null;

function std(
  name: string,
  tile: number,
  opts: Partial<Omit<THREE.MeshStandardMaterialParameters, "normalScale">> & { normalScale?: number } = {},
): THREE.MeshStandardMaterial {
  const s = surface(name);
  s.map.repeat.set(1, 1);
  const { normalScale: ns0, ...rest } = opts;
  const m = new THREE.MeshStandardMaterial({
    map: s.map,
    normalMap: s.normalMap,
    roughnessMap: s.roughnessMap,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    ...rest,
  });
  m.userData.tile = tile;
  const ns = opts.normalScale ?? 1;
  m.normalScale = new THREE.Vector2(ns, ns);
  return m;
}

export function buildMaterials(): MatKit {
  if (kit) return kit;
  const hedge = foliageSurface("hedge");

  const hedgeSide = new THREE.MeshStandardMaterial({
    map: hedge.map,
    alphaMap: hedge.alphaMap,
    normalMap: hedge.normalMap,
    roughnessMap: hedge.roughnessMap,
    transparent: false,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  hedgeSide.userData.tile = 1.6;
  hedgeSide.normalScale.set(1.4, 1.4);

  const water = new THREE.MeshStandardMaterial({
    color: 0x0a161a,
    roughness: 0.06,
    metalness: 0.25,
    normalMap: surface("water").normalMap,
    roughnessMap: surface("water").roughnessMap,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
    envMapIntensity: 1.2,
  });
  water.normalMap!.repeat.set(0.18, 0.18);
  water.normalScale.set(0.55, 0.55);

  const lampGlass = new THREE.MeshStandardMaterial({
    color: 0xfff3dd,
    emissive: new THREE.Color(0xffe6bd),
    emissiveIntensity: 3.4,
    roughness: 0.35,
    metalness: 0,
    toneMapped: true,
  });
  const lampGlassOff = lampGlass.clone();
  lampGlassOff.emissiveIntensity = 0.06;
  lampGlassOff.color.setHex(0x6d6a63);

  kit = {
    wallA: std("concrete", 2.4, { normalScale: 1.25 }),
    floorA: std("floorConcrete", 2.6, { normalScale: 1.35 }),
    ceilA: std("ceiling", 3.0, { normalScale: 0.9 }),
    wallB: std("metalPanel", 2.0, { metalness: 0.55, roughness: 0.75, normalScale: 1.0 }),
    floorB: std("metalFloor", 1.5, { metalness: 0.65, roughness: 0.7 }),
    wallD: std("concrete", 2.4, { color: new THREE.Color(0x8fa3a6), normalScale: 1.5 }),
    floorD: std("floorConcrete", 2.2, { color: new THREE.Color(0x7d8d8c), normalScale: 1.2 }),
    wallE: std("brick", 1.2, { normalScale: 1.7 }),
    floorE: std("stone", 2.2, { normalScale: 1.6 }),
    ceilE: std("stone", 2.6, { color: new THREE.Color(0x9a948c), normalScale: 1.2 }),
    soil: std("soil", 2.2, { normalScale: 1.5 }),
    hedgeSide,
    hedgeCore: new THREE.MeshStandardMaterial({ color: 0x121b0c, roughness: 1, metalness: 0 }),
    leaf: new THREE.MeshStandardMaterial({
      map: foliageSurface("leafTuft").map,
      transparent: false,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0,
    }),
    rust: std("rust", 1.0, { metalness: 0.35, roughness: 0.9 }),
    painted: std("paintedMetal", 1.2, { metalness: 0.3, roughness: 0.7 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x33373a, roughness: 0.55, metalness: 0.75, vertexColors: true }),
    lampGlass,
    lampGlassOff,
    water,
    concreteProp: std("concrete", 1.2, { normalScale: 1.1 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xcfc5ad, roughness: 0.95, side: THREE.DoubleSide }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0a1a14, emissive: new THREE.Color(0x1f6b4a), emissiveIntensity: 1.4, roughness: 0.3 }),
    dirt: std("soil", 1.6, { color: new THREE.Color(0x8a7a64) }),
  };
  return kit;
}

/** Repeat helper: materials are shared, so per-mesh tiling is done by baking
 *  world-space UVs into the geometry instead of changing map.repeat. */
export function tileOf(mat: THREE.MeshStandardMaterial): number {
  return (mat.userData.tile as number) ?? 2;
}

/* ---------------------------- wind shader ------------------------- */
const windMats: THREE.MeshStandardMaterial[] = [];

export function enableWind(mat: THREE.MeshStandardMaterial, strength = 1) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWind = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uTime;
         uniform float uWind;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           vec3 wPos = (instanceMatrix * vec4(transformed,1.0)).xyz;
         #else
           vec3 wPos = transformed;
         #endif
         float sway = sin(uTime * 1.1 + wPos.x * 0.7 + wPos.z * 0.55)
                    + 0.5 * sin(uTime * 2.3 + wPos.y * 1.7 + wPos.x * 0.3);
         float mask = clamp(position.y * 0.55 + 0.15, 0.0, 1.0);
         transformed += vec3(sway * 0.045 * uWind * mask, 0.0, sway * 0.03 * uWind * mask);`,
      );
    mat.userData.shader = shader;
  };
  mat.needsUpdate = true;
  windMats.push(mat);
}

export function updateWind(t: number) {
  for (const m of windMats) {
    const s = m.userData.shader as THREE.WebGLProgramParametersWithUniforms | undefined;
    if (s) (s.uniforms.uTime as { value: number }).value = t;
  }
}

export function disposeMaterials() {
  for (const m of Object.values(kit ?? {})) m.dispose();
  windMats.length = 0;
  kit = null;
}
