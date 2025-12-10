import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../constants";

export const createGeminiClient = () => {
  if (!process.env.API_KEY) {
    console.warn("Gemini API Key is missing. AI features will not work.");
    return null;
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const generateLessonPlan = async (topic: string): Promise<string> => {
  const ai = createGeminiClient();
  if (!ai) return "API Key missing.";

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Create a concise 5-point lesson plan for a class about: ${topic}. Format nicely with Markdown.`,
    });
    return response.text || "No response generated.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Error generating content. Please check your network or API key.";
  }
};

export const streamChatResponse = async function* (history: {role: string, parts: {text: string}[]}[], newMessage: string) {
    const ai = createGeminiClient();
    if(!ai) {
        yield "API Key missing.";
        return;
    }

    const chat = ai.chats.create({
        model: GEMINI_MODEL,
        history: history,
        config: {
            systemInstruction: "You are a helpful teaching assistant. Keep answers concise and relevant to the classroom context.",
        }
    });

    const result = await chat.sendMessageStream({ message: newMessage });
    
    for await (const chunk of result) {
        yield chunk.text || "";
    }
}