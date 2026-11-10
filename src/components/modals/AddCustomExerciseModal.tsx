import React, { useMemo } from 'react';
import { Language } from '../../../types';
import { translations } from '../../../translations';
import { Modal, ModalFooter } from '../Modal';
import { ExerciseCategory } from '../../constants/exercises';
import { EQ_CABLE, effectiveResistance, type Resistance } from '../../utils/exerciseAttrs';
import { ExerciseAttrFields } from '../ExerciseAttrFields';
import { RigChips } from '../PlateGlyph';
import { useExercisePrefs } from '../../contexts/ExercisePrefsContext';
import { useUserSettingsContext } from '../../contexts/UserSettingsContext';
import { loadKindOf } from '../../hooks/useLoadKind';
import { defaultProfile, gymSpecOf, newRigId, rigKind, rigListKey, type Rig } from '../../utils/loadable';

/** 新建时选的那一台：listKey＝馆|器材（换了器材弹窗会清掉） */
export interface NewExerciseRig {
  listKey: string;
  rig: Rig;
}

interface AddCustomExerciseModalProps {
  open: boolean;
  lang: Language;
  newExerciseName: string;
  setNewExerciseName: (s: string) => void;
  newExerciseCategory: ExerciseCategory;
  setNewExerciseCategory: (cat: ExerciseCategory) => void;
  newExerciseBodyPart: string;
  setNewExerciseBodyPart: (s: string) => void;
  /** 器材与阻力（2026-10-20 起单选；resistance 不写 = 跟器材默认） */
  newExerciseEquip: { equipment: string; resistance?: Resistance };
  setNewExerciseEquip: (v: { equipment: string; resistance?: Resistance }) => void;
  /** 细分，主细分在前；[] = 未细分 */
  newExerciseRegions: string[];
  setNewExerciseRegions: (ids: string[]) => void;
  /** 建好的动作加到哪：训练页弹层 / 计划编辑器的选动作弹层 */
  addsTo?: 'workout' | 'plan';
  /**
   * 这场训练的馆（加进训练时才给）：器材有自己的刻度（配重片 / 哑铃 / 壶铃 / 固定杠铃）就多一行「用哪一台」，
   * 建的时候直接选对——原来只能先按馆默认的单位建出来，再进动作设置改（2026-11-10 用户报）。null＝馆默认。
   */
  gym?: string;
  newExerciseRig: NewExerciseRig | null;
  setNewExerciseRig: (r: NewExerciseRig | null) => void;
  onClose: () => void;
  onConfirm: () => void;
}

/** 新建动作：名字 + 跟「部位与器材」同一张属性表 */
export const AddCustomExerciseModal: React.FC<AddCustomExerciseModalProps> = ({
  open,
  lang,
  newExerciseName,
  setNewExerciseName,
  newExerciseCategory,
  setNewExerciseCategory,
  newExerciseBodyPart,
  setNewExerciseBodyPart,
  newExerciseEquip,
  setNewExerciseEquip,
  newExerciseRegions,
  setNewExerciseRegions,
  addsTo = 'workout',
  gym,
  newExerciseRig,
  setNewExerciseRig,
  onClose,
  onConfirm,
}) => {
  const isCn = lang === Language.CN;
  const { appPrefs, unit } = useUserSettingsContext();
  const { customTags } = useExercisePrefs();
  const equipment = newExerciseEquip.equipment;
  const kind = loadKindOf({ equipment, resistance: effectiveResistance(equipment, newExerciseEquip.resistance, customTags) }, false);
  const listKey = rigListKey(gym, { kind, equipment });
  const stack = equipment === EQ_CABLE ? 'cable' : 'machine';
  const profile = (gym && appPrefs.gyms[gym]) || defaultProfile(unit === 'lbs' ? 'lbs' : 'kg');
  const gymSpec = rigKind(kind) ? gymSpecOf(profile, kind, stack) : null;
  // 这件器材在这个馆一台都没存过：现给一台另一种单位的（lb 馆里的 kg 龙门架），选了才存
  const otherId = useMemo(newRigId, [listKey]);
  const saved = listKey ? appPrefs.gymRigs[listKey] ?? [] : [];
  const rigList: Rig[] =
    gymSpec && rigKind(kind)
      ? [
          { ...gymSpec, id: '' },
          ...saved,
          ...(saved.length ? [] : [{ ...gymSpecOf(defaultProfile(gymSpec.u === 'kg' ? 'lbs' : 'kg'), kind, stack), id: otherId }]),
        ]
      : [];
  const rigSel = newExerciseRig?.rig.id ?? '';
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={translations.addCustomExercise[lang]}
      subtitle={
        addsTo === 'plan'
          ? isCn ? '创建后将加入计划' : 'Will be added to the plan'
          : isCn ? '创建后将加入本次训练' : 'Will be added to this workout'
      }
      size="md"
      layer="modal-2"
      dismissOnScrim={false}
      bodyClassName="overflow-y-auto max-h-[70vh] custom-scrollbar space-y-5"
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={translations.confirm[lang]}
          onCancel={onClose}
          onConfirm={onConfirm}
        />
      }
    >
      <div className="space-y-2">
        <label className="text-micro font-semibold text-secondary px-1">
          {isCn ? '动作名称' : 'Exercise Name'}
        </label>
        <input
          className="w-full bg-card border border-divider rounded-card py-4 px-6 text-primary outline-none focus:ring-2 focus:ring-accent transition-ui min-h-[48px]"
          value={newExerciseName}
          onChange={e => setNewExerciseName(e.target.value)}
          placeholder={translations.exerciseNamePlaceholder[lang]}
          autoFocus
        />
      </div>

      <ExerciseAttrFields
        lang={lang}
        testId="new-exercise-attrs"
        value={{
          category: newExerciseCategory,
          bodyPart: newExerciseBodyPart,
          regions: newExerciseRegions,
          equipment: newExerciseEquip.equipment,
          resistance: newExerciseEquip.resistance,
        }}
        onChange={v => {
          if (v.category !== newExerciseCategory) setNewExerciseCategory(v.category);
          if (v.bodyPart !== newExerciseBodyPart) setNewExerciseBodyPart(v.bodyPart);
          if (v.regions.join('|') !== newExerciseRegions.join('|')) setNewExerciseRegions(v.regions);
          // 换了器材 / 阻力，台子列表就不是同一份了
          if (v.equipment !== equipment || v.resistance !== newExerciseEquip.resistance) setNewExerciseRig(null);
          setNewExerciseEquip({ equipment: v.equipment, resistance: v.resistance });
        }}
      />

      {listKey && rigList.length > 0 && (
        <div className="space-y-2" data-testid="new-exercise-rig">
          <label className="text-micro font-semibold text-secondary px-1">
            {isCn ? `在 ${gym} 用哪一台` : `Machine at ${gym}`}
          </label>
          <RigChips
            kind={kind}
            isCn={isCn}
            list={rigList}
            sel={rigSel}
            onPick={id => {
              const rig = rigList.find(r => r.id === id);
              setNewExerciseRig(id && rig ? { listKey, rig } : null);
            }}
          />
        </div>
      )}
    </Modal>
  );
};
