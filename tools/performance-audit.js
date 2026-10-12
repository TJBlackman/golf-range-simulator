// Run from the welcome screen in DevTools on a Vite development server:
// (await import('/tools/performance-audit.js')).runPerformanceAudit()
// Reload afterward: the audit owns the animation loop and a synthetic scene.
export async function runPerformanceAudit() {
  const api = window.rangeSimulator;
  if (!api) throw new Error('Wait until the range is ready.');
  if (api.snapshot().started) throw new Error('Reload to the welcome screen before auditing an active shift.');
  const response = await fetch('/tools/performance-fixture.json');
  if (!response.ok) throw new Error('Run this audit on the Vite development server.');
  const fixture = await response.json();
  const world = api.world;
  world.renderer.setAnimationLoop(null);
  api.sim.restoreState(fixture.management);
  api.applyUpgrades();
  world.restoreState(fixture.world);
  world.syncGolfers(api.sim.golfers, api.sim.time);
  world.setHopper(api.sim.hopper);
  world.setQuality('high');
  world.setWind(fixture.preferences.wind);
  document.querySelector('#loading-screen').hidden = true;
  const gl = world.renderer.getContext();
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const results = [];
  const summary = values => {
    const sorted = values.slice().sort((a, b) => a - b);
    return { medianMs: sorted[Math.floor((sorted.length - 1) / 2)],
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1) };
  };
  for (const mode of ['chase', 'overview']) {
    world.cameraMode = mode;
    for (let i = 0; i < 180; i++) world.update(1 / 60);
    const work = [];
    for (let i = 0; i < 180; i++) {
      const start = performance.now();
      world.update(1 / 60);
      work.push(performance.now() - start);
    }
    const result = { mode, javascriptAndRenderSubmission: summary(work),
      render: { ...world.renderer.info.render }, memory: { ...world.renderer.info.memory } };
    if (timer) {
      const queries = [];
      try {
        for (let i = 0; i < 12; i++) {
          const query = gl.createQuery();
          if (!query) throw new Error('Could not allocate GPU query.');
          queries.push(query);
          gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
          world.update(1 / 60);
          gl.endQuery(timer.TIME_ELAPSED_EXT);
        }
        gl.flush();
        const deadline = performance.now() + 1500;
        while (!gl.getQueryParameter(queries.at(-1), gl.QUERY_RESULT_AVAILABLE) && performance.now() < deadline)
          await new Promise(resolve => setTimeout(resolve, 20));
        if (!gl.getParameter(timer.GPU_DISJOINT_EXT) && gl.getQueryParameter(queries.at(-1), gl.QUERY_RESULT_AVAILABLE))
          result.gpu = summary(queries.map(query => gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6));
        else result.gpu = { unavailable: 'Timer disjoint or browser did not complete queries in time.' };
      } finally {
        for (const query of queries) gl.deleteQuery(query);
      }
    }
    results.push(result);
  }
  return { viewport: [world.canvas.width, world.canvas.height], pixelRatio: world.renderer.getPixelRatio(),
    quality: world.quality, range: world.rangeYards, bays: world.golfers.length, results,
    errors: api.snapshot().errors };
}
