import type { Color } from '../lib/types';
import { Modal, PieceIcon } from './ui';

const CHOICES: [string, string][] = [
  ['q', 'queen'],
  ['r', 'rook'],
  ['b', 'bishop'],
  ['n', 'knight'],
];

export function PromotionDialog({ color, onPick, onCancel }: { color: Color; onPick: (p: string) => void; onCancel: () => void }) {
  return (
    <Modal title="Promote to" onClose={onCancel}>
      <div className="promo-choices">
        {CHOICES.map(([p, role]) => (
          <button key={p} className="promo-btn" onClick={() => onPick(p)} aria-label={role}>
            <PieceIcon role={role} color={color} size={64} />
          </button>
        ))}
      </div>
    </Modal>
  );
}
