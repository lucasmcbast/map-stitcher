/**
 * Tiny promise-based RPC over postMessage with progress events.
 * Worker side: `serve(handlers)`; main side: `new RpcClient(worker).call(method, args, onProgress)`.
 */

export interface RpcRequest {
  id: number;
  method: string;
  args: unknown;
}

export type RpcResponse =
  | { id: number; type: 'result'; result: unknown }
  | { id: number; type: 'error'; error: string }
  | { id: number; type: 'progress'; progress: unknown };

export type Handler = (args: any, ctx: { progress: (p: unknown) => void; transfer: (t: Transferable[]) => void }) => unknown;

/**
 * Serves RPC handlers. Requests are processed strictly in order (the engine keeps state between calls),
 * except methods listed in `concurrent` (e.g. viewer tiles), which run immediately.
 */
export function serve(handlers: Record<string, Handler>, concurrent: string[] = []): void {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  let queue: Promise<void> = Promise.resolve();
  scope.onmessage = (ev: MessageEvent<RpcRequest>) => {
    const { id, method, args } = ev.data;
    const run = async () => {
      const transfers: Transferable[] = [];
      try {
        const h = handlers[method];
        if (!h) throw new Error(`Unbekannte Methode: ${method}`);
        const result = await h(args, {
          progress: (progress) => scope.postMessage({ id, type: 'progress', progress } satisfies RpcResponse),
          transfer: (t) => transfers.push(...t),
        });
        scope.postMessage({ id, type: 'result', result } satisfies RpcResponse, transfers);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        scope.postMessage({ id, type: 'error', error } satisfies RpcResponse);
      }
    };
    if (concurrent.includes(method)) void run();
    else queue = queue.then(run);
  };
}

export class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (p: any) => void }>();

  constructor(readonly worker: Worker) {
    worker.onmessage = (ev: MessageEvent<RpcResponse>) => {
      const msg = ev.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') p.onProgress?.(msg.progress);
      else {
        this.pending.delete(msg.id);
        if (msg.type === 'result') p.resolve(msg.result);
        else p.reject(new Error(msg.error));
      }
    };
    worker.onerror = (ev) => {
      const err = new Error(ev.message || 'Der Hintergrundprozess ist abgestürzt (vermutlich zu wenig Arbeitsspeicher).');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  call<T>(method: string, args: unknown = {}, onProgress?: (p: any) => void, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ id, method, args } satisfies RpcRequest, transfer);
    });
  }

  terminate() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Abgebrochen'));
    this.pending.clear();
  }
}
