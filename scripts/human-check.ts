const ctx: any = new Proxy({}, { get: (_t, k) => k === "createLinearGradient" ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
import * as THREE from "three";
import { Human } from "../src/engine/human";
const h = new Human(0x222222);
for (const [label, speed] of [["standing", 0], ["walking", 3], ["sprinting", 4.9]] as const) {
  let minFoot = 9;
  for (let i = 0; i < 120; i++) { h.animate(1 / 60, speed); h.root.updateMatrixWorld(true); minFoot = Math.min(minFoot, new THREE.Box3().setFromObject(h.root).min.y); }
  const b = new THREE.Box3().setFromObject(h.root); const sz = b.getSize(new THREE.Vector3());
  console.log(label.padEnd(9), "height", sz.y.toFixed(3), "m  width", sz.x.toFixed(2), "m  lowest point over cycle", minFoot.toFixed(3), "m");
}
let tee = 0, tinted = 0;
h.root.traverse((o: any) => { if (o.isMesh && o.material.color?.getHex() === 0x222222) tee++; });
h.setShirt(0xaa3322);
h.root.traverse((o: any) => { if (o.isMesh && o.material.color?.getHex() === 0xaa3322) tinted++; });
console.log("meshes using shirt colour:", tee, "-> after setShirt:", tinted, "(tee body, 2 shoulders, 2 sleeves, 2 sleeve hems)");
