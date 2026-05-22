/**
 * 智能助手 Tab 容器：负责动态导入 AssistantRuntime（避免初始化时的循环依赖）
 */
import React, { useEffect, useState } from 'react';
import { Language } from '../../types';
import { useAssistantContext } from '../contexts/AssistantContext';

export const AssistantTabContainer: React.FC<{ lang: Language }> = ({ lang }) => {
  const assistantCtx = useAssistantContext();
  const [AssistantRuntime, setAssistantRuntime] = useState<
    null | typeof import('./AssistantRuntime')
  >(null);

  useEffect(() => {
    void import('./AssistantRuntime').then(m => setAssistantRuntime(m));
  }, []);

  if (!AssistantRuntime) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return <AssistantRuntime.default lang={lang} assistantCtx={assistantCtx} />;
};

export default AssistantTabContainer;
