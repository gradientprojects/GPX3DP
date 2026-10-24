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
    // soft light from below and the side so the underside label's edges read
    const under = new THREE.DirectionalLight(0xffffff, 1.6);
    under.position.set(1, 1.4, -0.5);
    this.scene.add(under);
    this.scene.add(this.group);
    this.svg.classList.add('label-overlay');
    el.append(this.svg);
    this.svg.addEventListener('pointerdown', (e) => this.dragStart(e));
    this.svg.addEventListener('pointermove', (e) => this.dragMove(e));
    this.svg.addEventListener('pointerup', (e) => this.dragEnd(e));
    this.svg.addEventListener('pointercancel', () => {
      this.svg.classList.remove('dragging');
      this.drag = null;
      this.render();
    });
    new ResizeObserver(() => this.resize()).observe(el);
  }

  // ------------------------------------------------------------ underside label box
  /** print size of the last build, mm */
  widthMm = 0;
  heightMm = 0;
  /** called after the label box is dragged (new box, model mm) or scaled (scale factor) */
  onLabelEdit: ((box: [number, number, number, number], scale: number) => void) | null = null;
  private svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private box: [number, number, number, number] | null = null;
  private drag: { mode: 'move' | 'scale'; p0: [number, number]; box0: [number, number, number, number]; corner: number; scale: number } | null =
    null;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  /** the built label's box in model mm, or null for none */
  setLabelBox(box: [number, number, number, number] | null) {
    this.box = box;
    this.drag = null;
    this.render();
  }

  /** model mm (x, y) to pixels in the pane */
  private toScreen(x: number, y: number): [number, number] {
    const v = new THREE.Vector3(x - this.widthMm / 2, y - this.heightMm / 2, 0).project(this.camera);
    return [((v.x + 1) / 2) * this.el.clientWidth, ((1 - v.y) / 2) * this.el.clientHeight];
  }

  /** pointer to model mm on the bottom plane */
  private toModel(e: PointerEvent): [number, number] | null {
    const r = this.el.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const p = this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
    return p ? [p.x + this.widthMm / 2, p.y + this.heightMm / 2] : null;
  }

  /** box while dragging, else the built one */
  private shownBox(): [number, number, number, number] | null {
    return this.drag ? this.dragBox() : this.box;
  }

  private dragStart(e: PointerEvent) {
    const t = e.target as SVGElement;
    if (!this.box || !t.dataset?.drag) return;
    const p = this.toModel(e);
    if (!p) return;
    e.preventDefault();
    this.svg.classList.add('dragging');
    this.svg.setPointerCapture(e.pointerId);
    this.drag = { mode: t.dataset.drag === 'move' ? 'move' : 'scale', p0: p, box0: [...this.box], corner: +(t.dataset.corner ?? 0), scale: 1 };
    this.cur = p;
  }

  private cur: [number, number] = [0, 0];
  private dragMove(e: PointerEvent) {
    if (!this.drag) return;
    const p = this.toModel(e);
    if (p) (this.cur = p), this.render();
  }

  private dragEnd(e: PointerEvent) {
    if (!this.drag) return;
    this.svg.classList.remove('dragging');
    const p = this.toModel(e);
    if (p) this.cur = p;
    const box = this.dragBox(), scale = this.drag.scale;
    const moved = Math.hypot(this.cur[0] - this.drag.p0[0], this.cur[1] - this.drag.p0[1]) > 0.2;
    if (!moved) return void ((this.drag = null), this.render());
    // keep showing the dragged box until the rebuilt label replaces it
    this.drag = null;
    this.box = box;
    this.render();
    this.onLabelEdit?.(box, scale);
  }

  /** box from the drag so far: moved, or scaled about the opposite corner (aspect kept), kept 3 mm inside */
  private dragBox(): [number, number, number, number] {
    const d = this.drag!, [x0, y0, x1, y1] = d.box0, W = this.widthMm, H = this.heightMm, m = 3;
    if (d.mode === 'move') {
      const bw = x1 - x0, bh = y1 - y0;
      const nx = Math.min(W - m - bw, Math.max(m, x0 + this.cur[0] - d.p0[0]));
      const ny = Math.min(H - m - bh, Math.max(m, y0 + this.cur[1] - d.p0[1]));
      return [nx, ny, nx + bw, ny + bh];
    }
    // corners 0..3: (x0,y0) (x1,y0) (x1,y1) (x0,y1); the opposite one stays put
    const cx = d.corner === 1 || d.corner === 2 ? x1 : x0, cy = d.corner >= 2 ? y1 : y0;
    const ox = cx === x1 ? x0 : x1, oy = cy === y1 ? y0 : y1;
    const k0 = Math.hypot(cx - ox, cy - oy);
    let k = Math.hypot(this.cur[0] - ox, this.cur[1] - oy) / k0;
    // stay inside the margin
    const sx = Math.sign(cx - ox), sy = Math.sign(cy - oy);
    const roomX = sx > 0 ? W - m - ox : ox - m, roomY = sy > 0 ? H - m - oy : oy - m;
    k = Math.max(0.2, Math.min(k, roomX / (x1 - x0), roomY / (y1 - y0)));
    d.scale = k;
    const ex = ox + sx * (x1 - x0) * k, ey = oy + sy * (y1 - y0) * k;
    return [Math.min(ox, ex), Math.min(oy, ey), Math.max(ox, ex), Math.max(oy, ey)];
  }

  /** draw the box (and center guides it would snap to) over the underside view */
  private drawOverlay() {
    const b = this.view === 'bottom' ? this.shownBox() : null;
    this.svg.style.display = b ? '' : 'none';
    if (!b) return;
    const [x0, y0, x1, y1] = b, W = this.widthMm, H = this.heightMm;
    const pts = [this.toScreen(x0, y0), this.toScreen(x1, y0), this.toScreen(x1, y1), this.toScreen(x0, y1)];
    const poly = pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
    const line = (a: [number, number], c: [number, number]) => `<line class="guide" x1="${a[0]}" y1="${a[1]}" x2="${c[0]}" y2="${c[1]}"/>`;
    let guides = '';
    if (this.drag && Math.abs((x0 + x1) / 2 - W / 2) < 3) guides += line(this.toScreen(W / 2, 0), this.toScreen(W / 2, H));
    if (this.drag && Math.abs((y0 + y1) / 2 - H / 2) < 3) guides += line(this.toScreen(0, H / 2), this.toScreen(W, H / 2));
    this.svg.innerHTML =
      guides +
      `<polygon data-drag="move" points="${poly}"/>` +
      pts.map((p, i) => `<rect data-drag="scale" data-corner="${i}" x="${p[0] - 6}" y="${p[1] - 6}" width="12" height="12"/>`).join('');
  }

  private size = '';
  private w = 0;
  private h = 0;
  /** looking at the top, or up at the underside */
  view: 'top' | 'bottom' = 'top';

  setView(v: 'top' | 'bottom') {
    this.view = v;
    if (this.w) this.frame(this.w, this.h);
    this.render();
  }

  setParts(parts: PartMesh[], colors: Record<string, string>, widthMm: number, heightMm: number, labelDepthMm = 0) {
    this.widthMm = widthMm;
    this.heightMm = heightMm;
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
      // shade the underside label's pocket darker so it reads in the preview: the only terrain vertices
      // strictly between the bottom and the label depth (everything else is at 0 or above the depth cap)
      const shadeLabel = p.name === 'terrain' && labelDepthMm > 0;
      if (shadeLabel) {
        const c = new Float32Array(p.positions.length).fill(1);
        for (let i = 2; i < p.positions.length; i += 3) {
          const z = p.positions[i];
          if (z > 1e-4 && z < labelDepthMm + 1e-4) c[i - 2] = c[i - 1] = c[i] = 0.45;
        }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      }
      const mat = new THREE.MeshStandardMaterial({ color: colors[p.name] ?? '#cccccc', flatShading: true, roughness: 0.85, vertexColors: shadeLabel });
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
    this.w = w;
    this.h = h;
    const d = Math.max(w, h);
    // underside: below and tilted toward +y, so +y is up on screen and the mirrored label reads like the
    // flipped print; the tilt lets the letter walls catch the low light
    if (this.view === 'bottom') this.camera.position.set(0, d * 0.75, -d * 1.45);
    else this.camera.position.set(0, -d * 1.25, d * 0.95);
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
      this.drawOverlay();
    });
  }
}
