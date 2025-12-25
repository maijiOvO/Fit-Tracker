
import { GoogleGenAI } from "@google/genai";
import { WorkoutSession, Language } from "../types";

const getSystemInstruction = (lang: Language) => {
  return lang === Language.CN
    ? "你是一位极其专业的健身教练。你的回答必须严格限于：训练科学、营养学、运动解剖学和健身计划。如果用户提问与这些无关，请礼貌地告知你只能回答健身相关问题。重要规则：仅当用户的提问涉及身体不适、疼痛、伤病或医疗健康咨询时，才在回答最后附加免责声明：『注：此建议由 AI 生成，仅供参考。若有身体不适或患有疾病，请务必立即咨询专业医疗人员。』对于普通的训练动作指导、营养知识或计划制定，请保持专业简洁，不要附加免责声明。请使用中文回答。"
    : "You are a highly professional fitness coach. Your answers must be strictly limited to: exercise science, nutrition, sports anatomy, and workout planning. If a user asks about unrelated topics, politely state you can only answer fitness-related questions. IMPORTANT: Only if the user's query involves physical discomfort, pain, injuries, or medical health consultations, should you append this disclaimer at the end: 'Note: This advice is AI-generated and for reference only. If you experience discomfort or have medical conditions, please consult a healthcare professional immediately.' For general exercise tips, nutrition facts, or routine planning, keep it professional and do not include the disclaimer. Respond in English.";
};

export const analyzeWorkout = async (sessions: WorkoutSession[], lang: Language): Promise<string> => {
  // Fix: Strictly use process.env.API_KEY and gemini-3-pro-preview for complex analysis
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = lang === Language.CN 
    ? `请分析以下健身记录并给出建议：\n${JSON.stringify(sessions)}`
    : `Please analyze the following fitness logs and provide recommendations:\n${JSON.stringify(sessions)}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
      config: {
        systemInstruction: getSystemInstruction(lang),
        temperature: 0.7,
      },
    });

    return response.text || "Analysis failed.";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return lang === Language.CN ? "分析出错，请稍后再试。" : "Error occurred during analysis. Please try again later.";
  }
};

export const chatWithCoach = async (message: string, history: { role: 'user' | 'model', parts: { text: string }[] }[], lang: Language): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [
        ...history,
        { role: 'user', parts: [{ text: message }] }
      ],
      config: {
        systemInstruction: getSystemInstruction(lang),
        temperature: 0.8,
      },
    });

    return response.text || "I'm sorry, I couldn't process that.";
  } catch (error) {
    console.error("Gemini Chat Error:", error);
    return lang === Language.CN ? "连接 AI 教练失败，请稍后再试。" : "Failed to connect to AI Coach. Please try again later.";
  }
};
