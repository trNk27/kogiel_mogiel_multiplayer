import { ANSWER_STYLES } from '../../../shared/protocol';

export function Shape({ index, size = 48, fill = '#fff' }: { index: number; size?: number; fill?: string }) {
  const shape = ANSWER_STYLES[index]?.shape;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      {shape === 'triangle' && <path d="M20 4 L37 34 L3 34 Z" fill={fill} />}
      {shape === 'diamond' && <path d="M20 2 L38 20 L20 38 L2 20 Z" fill={fill} />}
      {shape === 'circle' && <circle cx="20" cy="20" r="17" fill={fill} />}
      {shape === 'square' && <rect x="5" y="5" width="30" height="30" rx="3" fill={fill} />}
    </svg>
  );
}
