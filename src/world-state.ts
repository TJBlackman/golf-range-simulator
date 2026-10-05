/** Validate browser-save data before the renderer mutates any live objects. */
export function validateWorldState(value: unknown) {
  const fail = () => { throw new Error("Save contains invalid scene data."); };
  const object = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) fail();
    return v as Record<string, unknown>;
  };
  const number = (v: unknown, min = -1000000000000, max = 1000000000000) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) fail();
  };
  const boolean = (v: unknown) => { if (typeof v !== "boolean") fail(); };
  const array = (v: unknown, max = 10000): unknown[] => {
    if (!Array.isArray(v) || v.length > max) fail();
    return v as unknown[];
  };
  const vector = (v: unknown) => {
    const a = array(v, 3); if (a.length !== 3) fail(); a.forEach(x => number(x));
  };
  const point = (v: unknown) => {
    const p = object(v); for (const key of ["x", "y", "z"]) number(p[key]);
  };
  const transform = (v: unknown) => {
    const t = object(v); vector(t.position); vector(t.rotation); vector(t.scale);
  };
  const root = object(value);
  if (root.version !== 1 || ![100,150,200,250,300].includes(root.rangeYards as number) ||
      ![7,9,12].includes(root.bayCount as number)) fail();
  for (const key of ["elapsed", "tractorAngle", "tractorSpeed", "lookYaw", "lookPitch", "lookZoom", "lookHoldUntil"])
    number(root[key], key === "elapsed" ? 0 : -100000, 1000000000);
  vector(root.tractorPosition); vector(root.cameraPosition); vector(root.cameraTarget);
  if (!["chase", "overview"].includes(root.cameraMode as string)) fail();
  boolean(root.looking);
  array(root.wheelRotations, 4).forEach(x => number(x));
  array(root.steeringRotations, 2).forEach(x => number(x));
  number(root.collectorRotation);
  array(root.latchedCollisions, 100).forEach(x => { if (typeof x !== "string" || x.length > 100) fail(); });
  array(root.balls, 10000).forEach(v => {
    const b = object(v); vector(b.position); boolean(b.active);
    if (b.pickableAt !== null && b.pickableAt !== undefined) number(b.pickableAt, 0, 1000000000);
  });
  array(root.airShots, 200).forEach(v => {
    const a = object(v); number(a.time); point(a.point);
    if (a.lost !== undefined) boolean(a.lost);
    const s = object(a.shot);
    for (const key of ["carry","total","apex","duration","speed"]) number(s[key], 0);
    point(s.end); point(s.landing);
    const points = array(s.points, 20000); if (points.length < 2) fail();
    let previous = -1;
    points.forEach(v => {
      point(v); const p = object(v); number(p.t, 0);
      if ((p.t as number) < previous) fail(); previous = p.t as number;
    });
  });
  array(root.bouncingBalls, 1000).forEach(v => { const b=object(v); vector(b.position); vector(b.velocity); });
  const golfers = array(root.golfers, 12);
  if (golfers.length !== root.bayCount) fail();
  golfers.forEach(v => {
    const g = object(v); vector(g.position); number(g.rotation); number(g.swingTime, 0, 60);
    number(g.swingSpeed, 0, 10); boolean(g.swingPaused); boolean(g.swingEnabled); boolean(g.visible);
    if (!["casual","family","grinder","pro"].includes(g.type as string) ||
        !["playing","leaving","empty"].includes(g.status as string)) fail();
    if (g.walk !== null) {
      const w=object(g.walk); vector(w.from); vector(w.to); number(w.start,0,1000000000); number(w.duration,.01,60); boolean(w.hide);
    }
  });
  array(root.golfCarts, 50).forEach(v => {
    const c=object(v); number(c.golfer,0,golfers.length-1);
    if (!Number.isInteger(c.golfer) || !["arriving","parked","departing"].includes(c.phase as string)) fail();
    vector(c.park); vector(c.position); number(c.rotation); number(c.start,0,1000000000); boolean(c.driverVisible);
    if (typeof c.polo !== "string" || !/^[0-9a-f]{6}$/i.test(c.polo)) fail();
    const wheels=array(c.wheels,4); if(wheels.length!==4) fail(); wheels.forEach(x=>number(x));
  });
  array(root.animals, 100).forEach(v => {
    const a=object(v); vector(a.position); vector(a.home); vector(a.target);
    for(const key of ["heading","until","phase","walkTime","walkSpeed"])number(a[key],key==="until"?0:-100000,1000000000);
    if (!["goose","fox","deer"].includes(a.id as string) || !["graze","roam","dash","flee"].includes(a.mode as string)) fail();
  });
  array(root.hazards, 20).forEach(v => {
    const h=object(v); if(typeof h.id!=="string")fail(); number(h.z); boolean(h.cleared);
    array(h.objects,10).forEach(transform);
    const o=object(h.obstacle); if(o.id!==h.id || typeof o.name!=="string")fail();
    if(o.kind==="circle"){number(o.x);number(o.z);number(o.radius,0,100);}
    else if(o.kind==="box"){for(const key of ["minX","maxX","minZ","maxZ"])number(o[key]);}
    else fail();
  });
  const depots=array(root.depots,2); if(depots.length<1)fail(); depots.forEach(vector);
  if(root.helper!==null){
    const h=object(root.helper);vector(h.position);number(h.angle);number(h.hopper,0,80);
    number(h.index,0,100);if(!Number.isInteger(h.index))fail();number(h.pauseUntil,0,1000000000);number(h.roller);
  }
}
