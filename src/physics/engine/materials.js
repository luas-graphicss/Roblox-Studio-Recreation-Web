let nextMaterialId = 0;

export class Material {
  constructor(name = "") {
    this.id = ++nextMaterialId;
    this.name = typeof name === "string" ? name : "";
    this.friction = -1;
    this.restitution = -1;
  }
}

export class ContactMaterial {
  constructor(m1, m2, options = {}) {
    this.materials = [m1, m2];
    this.friction = Number.isFinite(options.friction) ? Math.max(0, options.friction) : 0.3;
    this.restitution = Number.isFinite(options.restitution)
      ? Math.min(1, Math.max(0, options.restitution))
      : 0.3;
  }
}

export function contactMaterialKey(m1, m2) {
  return m1.id < m2.id ? m1.id + "|" + m2.id : m2.id + "|" + m1.id;
}
