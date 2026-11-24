// Small display helpers shared by the pages.
import { FRAMES, isFrameKey } from '@podium/shared';

export const frameCss = (frame: string): string => (isFrameKey(frame) ? FRAMES[frame].css : 'transparent');
