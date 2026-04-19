const fs = require('fs');
const content = fs.readFileSync('App.tsx', 'utf8');

// 新的 ExerciseCard 组件调用代码
const newCode = `
          <div className="space-y-6">
            {currentWorkout.exercises?.map((ex, exIdx) => {
              const isBodyweight = isBodyweightMode(ex); 
              const isPyramid = isPyramidEnabled(ex);

              return (
                <ExerciseCard
                  key={ex.id}
                  exercise={ex}
                  exIdx={exIdx}
                  lang={lang}
                  unit={unit}
                  isBodyweight={isBodyweight}
                  isPyramid={isPyramid}
                  exerciseNotes={exerciseNotes}
                  getActiveMetrics={getActiveMetrics}
                  resolveName={resolveName}
                  onUpdateExercise={(idx, updates) => {
                    const exs = [...currentWorkout.exercises!];
                    exs[idx] = { ...exs[idx], ...updates };
                    setCurrentWorkout({...currentWorkout, exercises: exs});
                  }}
                  onDeleteExercise={(idx) => {
                    setCurrentWorkout({...currentWorkout, exercises: currentWorkout.exercises!.filter((_, i) => i !== idx)});
                  }}
                  onOpenTimePicker={(idx, setIdx, currentSeconds) => {
                    openTimePicker(idx, setIdx, currentSeconds);
                  }}
                  onToggleNote={(name) => {
                    setNoteModalData({ name, note: exerciseNotes[name] || '' });
                  }}
                  onOpenMetricModal={(name) => {
                    setShowMetricModal({ name });
                  }}
                  onSetUpdate={(exIdx, setIdx, updates) => {
                    const exs = [...currentWorkout.exercises!];
                    exs[exIdx].sets[setIdx] = { ...exs[exIdx].sets[setIdx], ...updates };
                    setCurrentWorkout({...currentWorkout, exercises: exs});
                  }}
                  onAddSet={(idx) => {
                    const exs = [...currentWorkout.exercises!];
                    const currentSets = exs[idx].sets;
                    const lastSet = currentSets.length > 0 ? currentSets[currentSets.length - 1] : null;
                    let newSet = lastSet 
                      ? { ...lastSet, id: Date.now().toString() }
                      : { id: Date.now().toString(), weight: 0, reps: 0 };
                    exs[idx].sets.push(newSet);
                    setCurrentWorkout({...currentWorkout, exercises: exs});
                  }}
                  onRemoveSet={(exIdx, setIdx) => {
                    const exs = [...currentWorkout.exercises!];
                    exs[exIdx].sets = exs[exIdx].sets.filter((_, i) => i !== setIdx);
                    setCurrentWorkout({...currentWorkout, exercises: exs});
                  }}
                  onOpenRestSettings={(name) => openRestSettings(name)}
                  getRestPref={getRestPref}
                />
              );
            })}
          </div>`;

// 查找替换的起始位置
const startMarker = 'placeholder={translations.trainingTitlePlaceholder[lang]} /></div><div className="space-y-6">{currentWorkout.exercises?.map((ex, exIdx) => {';
const startIdx = content.indexOf(startMarker);
console.log('Start index:', startIdx);

// 查找结束位置 - 直接搜索 </div>); })}</div>
const endMarker = '</div>); })}</div>';
const endIdx = content.indexOf(endMarker, startIdx);
console.log('End index:', endIdx);

if (startIdx === -1) {
  console.log('Start marker not found!');
  process.exit(1);
}

if (endIdx === -1) {
  console.log('End marker not found!');
  process.exit(1);
}

console.log('Start:', startIdx, 'End:', endIdx);
console.log('Replacing', endIdx - startIdx + endMarker.length, 'characters');

// 执行替换
const newContent = content.substring(0, startIdx) + newCode + content.substring(endIdx + endMarker.length);

fs.writeFileSync('App.tsx', newContent, 'utf8');
console.log('Done!');
