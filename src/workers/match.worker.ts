/// <reference lib="webworker" />
import { matchPairsCoarse, prepareCoarse, type CoarseContext } from '../stitching/coarseMatch';
import type { MatchImage } from '../types';
import { serve } from './rpc';

// Pair matching worker: one of several, spawned by the engine worker for the O(n²) coarse matching stage.
let ctx: CoarseContext | null = null;

serve({
  init: ({ images }: { images: MatchImage[] }) => {
    ctx = prepareCoarse(images);
    return true;
  },
  match: ({ pairs }: { pairs: [number, number][] }) => {
    if (!ctx) throw new Error('Matcher nicht initialisiert');
    return matchPairsCoarse(ctx, pairs);
  },
});
