import { RpcClient } from './rpc';

let engine: RpcClient | null = null;
let render: RpcClient | null = null;

/** Engine worker (decoding, analysis, layout). Created lazily, one per tab. */
export function engineClient(): RpcClient {
  engine ??= new RpcClient(new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module', name: 'map-stitcher-engine' }));
  return engine;
}

/** Render worker (preview, viewer tiles, export). */
export function renderClient(): RpcClient {
  render ??= new RpcClient(new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module', name: 'map-stitcher-render' }));
  return render;
}

/** Restarts the render worker, e.g. after it ran out of memory. */
export function resetRenderClient(): void {
  render?.terminate();
  render = null;
}

/** Stops a running analysis by terminating the engine worker (a fresh one is created on demand). */
export function resetEngineClient(): void {
  engine?.terminate();
  engine = null;
}
