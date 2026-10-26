/**
 * 全局撤销 / 重做（services/undoJournal.ts）。顶栏里一对图标按钮，没东西可撤时变灰、不隐藏 —— 位置不跳。
 * 挂 data-undo-ignore：按它们不开新的一步。真正干活的是 App 里登记的 useGlobalUndoHost。
 */
import React, { useSyncExternalStore } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { undoJournal } from '../../services/undoJournal';
import { runGlobalUndo } from '../hooks/useGlobalUndo';

interface Props {
  isCn: boolean;
}

export const UndoRedoButtons: React.FC<Props> = ({ isCn }) => {
  const st = useSyncExternalStore(undoJournal.subscribe, undoJournal.getState);
  const btn =
    'w-9 h-11 inline-flex items-center justify-center rounded-control text-secondary transition-ui active:scale-press-sm disabled:text-tertiary disabled:opacity-40';
  return (
    <div className="flex items-center flex-shrink-0" data-undo-ignore data-testid="undo-redo">
      <button
        type="button"
        className={btn}
        disabled={!st.canUndo}
        onClick={() => void runGlobalUndo('undo')}
        aria-label={isCn ? `撤销${st.undoLabel ? `：${st.undoLabel}` : ''}` : `Undo${st.undoLabel ? `: ${st.undoLabel}` : ''}`}
        data-testid="global-undo"
      >
        <Undo2 size={18} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className={btn}
        disabled={!st.canRedo}
        onClick={() => void runGlobalUndo('redo')}
        aria-label={isCn ? `重做${st.redoLabel ? `：${st.redoLabel}` : ''}` : `Redo${st.redoLabel ? `: ${st.redoLabel}` : ''}`}
        data-testid="global-redo"
      >
        <Redo2 size={18} strokeWidth={1.75} />
      </button>
    </div>
  );
};
