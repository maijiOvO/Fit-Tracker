/**
 * 「部位与器材」：改某个动作的训练类型、部位、细分、器材（原「编辑标签」）。
 * 从添加动作弹层的动作面板进来。删除不在这里（动作面板里「从动作库删除」，先执行 + 撤销）。
 */
import React, { useState, useEffect } from 'react';
import { Check, Columns3, Sparkles, Filter } from 'lucide-react';
import { ExerciseCategory, ExerciseDefinition, Language } from '../../types';
import { translations } from '../../translations';
import { BODY_PARTS, EQUIPMENT_TAGS } from '../constants/exercises';
import { Modal, ModalFooter } from './Modal';
import { RegionChooser, hasRegionSection } from './RegionChooser';

interface EditExerciseTagsModalProps {
  open: boolean;
  exercise: ExerciseDefinition | null;
  lang: Language;
  customTags: {
    id: string;
    name: string;
    category: 'bodyPart' | 'equipment' | 'region';
  }[];
  getTagName: (tid: string) => string;
  onClose: () => void;
  onSave: (exerciseId: string, bodyPart: string, tags: string[], region: string, category: ExerciseCategory) => void;
}

export const EditExerciseTagsModal: React.FC<EditExerciseTagsModalProps> = ({
  open,
  exercise,
  lang,
  customTags,
  getTagName,
  onClose,
  onSave,
}) => {
  const [category, setCategory] = useState<ExerciseCategory>('STRENGTH');
  const [bodyPart, setBodyPart] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [region, setRegion] = useState('');

  useEffect(() => {
    if (open && exercise) {
      setCategory(exercise.category || 'STRENGTH');
      setBodyPart(exercise.bodyPart || '');
      setTags(exercise.tags || []);
      setRegion(exercise.region || '');
    }
  }, [open, exercise]);

  if (!open || !exercise) return null;

  const isCn = lang === Language.CN;
  const bodyPartIds = [
    ...BODY_PARTS,
    ...customTags.filter(ct => ct.category === 'bodyPart').map(ct => ct.id),
  ];
  const equipmentIds = [
    ...EQUIPMENT_TAGS,
    ...customTags.filter(ct => ct.category === 'equipment').map(ct => ct.id),
  ];

  const toggleEquipment = (id: string) => {
    setTags(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={exercise.name[lang]}
      subtitle={isCn ? '部位与器材' : 'Part & gear'}
      size="md"
      // 从弹层的动作菜单里开出来，再往上一层
      layer="modal-3"
      dismissOnScrim={false}
      bodyClassName="overflow-y-auto max-h-[65vh] custom-scrollbar space-y-5"
      footer={
        <ModalFooter
          cancelLabel={isCn ? '取消' : 'Cancel'}
          confirmLabel={isCn ? '保存' : 'Save'}
          onCancel={onClose}
          onConfirm={() => {
            // 部位换了、细分没跟着选：存成未细分（细分只认当前部位下的）
            onSave(exercise.id, bodyPart, tags, hasRegionSection(bodyPart, category) ? region : '', category);
            onClose();
          }}
          confirmIcon={<Check size={16} strokeWidth={2.5} />}
        />
      }
    >

        {/* 训练类型（category-not-editable：原先只能在新建时选，建错了只能删了重建） */}
        <div>
          <h4 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-2">
            {isCn ? '训练类型' : 'Category'}
          </h4>
          <div className="flex gap-2">
            {(['STRENGTH', 'CARDIO', 'FREE'] as ExerciseCategory[]).map(cat => (
              <button
                key={cat}
                type="button"
                aria-pressed={category === cat}
                onClick={() => setCategory(cat)}
                className={`flex-1 min-h-[40px] rounded-control text-xs font-bold transition-ui ${
                  category === cat ? 'bg-accent text-on-accent' : 'bg-card text-secondary hover:bg-card-hover'
                }`}
              >
                {cat === 'STRENGTH' && translations.strengthTraining[lang]}
                {cat === 'CARDIO' && translations.cardioTraining[lang]}
                {cat === 'FREE' && translations.freeTraining[lang]}
              </button>
            ))}
          </div>
        </div>

        {/* 部位（单选） */}
        <div>
          <h4 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-2 flex items-center gap-1.5">
            <Sparkles size={11} /> {isCn ? '训练部位' : 'Body Part'}
            <span className="text-tertiary normal-case tracking-normal">
              · {isCn ? '单选' : 'single'}
            </span>
          </h4>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setBodyPart('')}
              className={`min-h-[40px] px-4 rounded-control text-xs font-bold uppercase tracking-wider transition-ui ${
                bodyPart === ''
                  ? 'bg-accent text-on-accent'
                  : 'bg-card text-tertiary hover:bg-card-hover'
              }`}
            >
              {isCn ? '无' : 'None'}
            </button>
            {bodyPartIds.map(id => {
              const name = getTagName(id);
              if (!name) return null;
              return (
                <button
                  key={id}
                  onClick={() => setBodyPart(id)}
                  className={`min-h-[40px] px-4 rounded-control text-xs font-bold uppercase tracking-wider transition-ui ${
                    bodyPart === id
                      ? 'bg-accent text-on-accent shadow-elevated'
                      : 'bg-card text-secondary hover:bg-card-hover'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>

        {/* 细分（单选，随部位联动；第 3 条） */}
        {hasRegionSection(bodyPart, category) && (
          <div>
            <h4 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-2 flex items-center gap-1.5">
              <Columns3 size={11} /> {isCn ? '细分' : 'Region'}
              <span className="text-tertiary normal-case tracking-normal">
                · {isCn ? '单选' : 'single'}
              </span>
            </h4>
            <RegionChooser
              part={bodyPart}
              category={category}
              value={region}
              onChange={setRegion}
              lang={lang}
            />
          </div>
        )}

        {/* 器材（多选） */}
        <div>
          <h4 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-2 flex items-center gap-1.5">
            <Filter size={11} /> {isCn ? '使用器材' : 'Equipment'}
            <span className="text-tertiary normal-case tracking-normal">
              · {isCn ? '多选' : 'multi'}
            </span>
          </h4>
          <div className="flex flex-wrap gap-2">
            {equipmentIds.map(id => {
              const name = getTagName(id);
              if (!name) return null;
              const active = tags.includes(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleEquipment(id)}
                  className={`min-h-[40px] px-4 rounded-control text-xs font-bold uppercase tracking-wider transition-ui ${
                    active
                      ? 'bg-accent text-on-accent shadow-elevated'
                      : 'bg-card text-secondary hover:bg-card-hover'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>

    </Modal>
  );
};

export default EditExerciseTagsModal;
