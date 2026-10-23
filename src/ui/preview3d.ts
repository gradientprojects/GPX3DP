import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PartMesh } from '../worker/messages';

/** three.js preview of the generated parts, z up, orbit controls. Renders on demand. */
export class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
  private controls: OrbitControls;
  private group = new THREE.Group();
  private queued = false;

  constructor(private el: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    el.prepend(this.renderer.domElement);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-1, -0.6, 1.2);
    this.scene.add(sun);
    this.scene.add(this.group);
    new ResizeObserver(() => this.resize()).observe(el);
  }

  private size = '';

  setParts(parts: PartMesh[], colors: Record<string, string>, widthMm: number, heightMm: number) {
    const size = `${widthMm.toFixed(1)}x${heightMm.toFixed(1)}`;
    const fresh = size !== this.size;
    this.size = size;
    for (const c of this.group.children) {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.group.clear();
    for (const p of parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      g.setIndex(new THREE.BufferAttribute(p.indices, 1));
      g.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: colors[p.name] ?? '#cccccc', flatShading: true, roughness: 0.85 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(-widthMm / 2, -heightMm / 2, 0);
      this.group.add(mesh);
    }
    if (fresh) this.frame(widthMm, heightMm);
    this.render();
  }

  setColors(colors: Record<string, string>, names: string[]) {
    this.group.children.forEach((c, i) => ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set(colors[names[i]] ?? '#ccc'));
    this.render();
  }

  frame(w: number, h: number) {
    const d = Math.max(w, h);
    this.camera.position.set(0, -d * 1.25, d * 0.95);
    this.camera.near = d / 100;
    this.camera.far = d * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      if (this.controls.update()) this.render();
      this.renderer.render(this.scene, this.camera);
    });
  }
}
