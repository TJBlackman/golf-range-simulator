import * as THREE from "three";

/** A lit amber lens and a rotating beam on the picker's existing roof beacon. */
export class HopperBeacon {
  readonly rotor = new THREE.Group();
  private readonly lenses: THREE.MeshStandardMaterial[] = [];
  private readonly light = new THREE.SpotLight("#ffb43b", 12, 5, 0.45, 0.6, 2);

  constructor(cart: THREE.Object3D) {
    this.rotor.name = "HopperBeaconRotor";
    this.rotor.visible = false;
    const beacon = cart.getObjectByName("Beacon");
    for (const name of ["Beacon", "BeaconDome"]) {
      const lens = cart.getObjectByName(name);
      if (!(lens instanceof THREE.Mesh)) continue;
      const materials = Array.isArray(lens.material) ? lens.material : [lens.material];
      const copies = materials.map(material => {
        const copy = material.clone();
        if (copy instanceof THREE.MeshStandardMaterial) {
          copy.emissive.set("#ffab23");
          copy.emissiveIntensity = 0;
          this.lenses.push(copy);
        }
        return copy;
      });
      lens.material = Array.isArray(lens.material) ? copies : copies[0];
    }
    cart.updateWorldMatrix(true, true);
    this.rotor.position.copy(beacon
      ? cart.worldToLocal(beacon.getWorldPosition(new THREE.Vector3()))
      : new THREE.Vector3(0, 2.17, -0.7));
    // The asymmetric glow makes the rotation visible even in bright daylight.
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.85, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: "#ffbd50", transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    beam.rotation.z = Math.PI / 2;
    beam.position.x = 0.48;
    this.light.target.position.set(2, -0.2, 0);
    this.rotor.add(beam, this.light, this.light.target);
    cart.add(this.rotor);
  }

  setLoad(count: number, capacity: number) {
    this.rotor.visible = capacity > 0 && count >= capacity;
    for (const lens of this.lenses) lens.emissiveIntensity = this.rotor.visible ? 2.5 : 0;
  }

  update(dt: number) {
    if (this.rotor.visible)
      this.rotor.rotation.y = (this.rotor.rotation.y + dt * Math.PI * 2) % (Math.PI * 2);
  }
}
