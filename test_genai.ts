import { GoogleGenAI } from "@google/genai";
async function test() {
  try {
    const ai = new GoogleGenAI({ apiKey: "invalid_key_123" });
    const aiResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "hello",
    });
    console.log("Success:", aiResponse.text);
  } catch(e) {
    console.error("Error:", e);
  }
}
test();