// The builder's Web Worker. The label map arrives as an ArrayBuffer from the
// page, already in this tab's memory, and the meshes and scores go back the
// same way. Nothing here makes a network request or stores anything: nothing
// leaves the tab. The last case is held only so the margin can be changed,
// and goes when the next one is built, the builder is cleared or the tab closes.

import { buildFromNifti, buildSample, remargin, type MarginState } from './builder/build.ts';
import { meshBuffers, type FromWorker, type ToWorker } from './builder/protocol.ts';

type WorkerScope = {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

const scope = globalThis as unknown as WorkerScope;
let state: MarginState | null = null;

scope.onmessage = (event) => {
  const message = event.data;
  const { id } = message;
  const progress = (stage: Parameters<Parameters<typeof buildSample>[1]>[0], text: string, fraction: number) =>
    scope.postMessage({ type: 'progress', id, stage, message: text, fraction });

  const run = async () => {
    try {
      if (message.type === 'margin') {
        if (!state) throw new Error('Build a kidney first.');
        const { planning, band } = remargin(state, message.marginMm);
        scope.postMessage({ type: 'margin', id, planning, band }, band ? meshBuffers([band]) : []);
        return;
      }
      // The previous case stays until a new one succeeds, because the viewer
      // keeps showing it when a file is refused.
      const result =
        message.type === 'sample'
          ? buildSample(message.marginMm, progress)
          : await buildFromNifti(message.buffer, message.marginMm, progress);
      state = result.state;
      scope.postMessage({ type: 'result', id, output: result.output }, meshBuffers(result.output.meshes));
    } catch (error) {
      scope.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
    }
  };
  void run();
};
