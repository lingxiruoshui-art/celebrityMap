import { GoogleGenAI, Type, Schema } from "@google/genai";

let ai: GoogleGenAI | null = null;

export function getGemini(apiKeyOverride?: string): GoogleGenAI {
  if (!ai || apiKeyOverride) {
    // Note: process.env.GEMINI_API_KEY is handled by the platform in the browser
    const apiKey = apiKeyOverride || process.env.GEMINI_API_KEY || "";
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
}

export const ARCHIVE_PROMPT = (name: string, categories: string[], existingNames: string) => `
你是一位研究历史人物的传记专家。请为人物 "${name}" 撰写一份既有历史厚度又风趣幽默的传记。

要求：
1. 关键词 (keyword)：该人物最经典、最具代表性的一句人生格言。
2. 生卒年月 (lifespan)：如“公元前571年-公元前471年”或“1879年-1955年”。
3. 出生地点 (birthplace)：该人物的出生地。
4. 分类定位 (category)：从以下选择最合适的：[${categories.join("、")}]。
5. 传记内容 (biography)：
   - 必须正规且诙谐幽默，直接进入主题。
   - **禁止**出现脱口秀、开场白、解说辞，严禁使用“大家好”、“今天咱们聊聊”等。
   - 描述应客观且具有文学感。
   - 必须分成 3-4 个段落。
6. 成就 (achievements)：列出 3-5 项关键成就。
7. 核心人脉 (relationships)：列出 5 个与此人有重大关联的 [实名历史人物]。
   - 包含馆内已有：[${existingNames.slice(0, 500)}]。
   - **严禁返回 undefined 或 空人名**。
   - personName 必须是标准中文译名。
   - relationshipType 请用 20-30 字描述。
8. 活动坐标 (latitude, longitude)：依据其主要活动区域。
所有返回内容必须使用简体中文，并以严格的 JSON 格式返回。
`;

export const ARCHIVE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    keyword: { type: Type.STRING },
    lifespan: { type: Type.STRING },
    birthplace: { type: Type.STRING },
    biography: { type: Type.STRING },
    achievements: { type: Type.ARRAY, items: { type: Type.STRING } },
    category: { type: Type.STRING },
    latitude: { type: Type.NUMBER },
    longitude: { type: Type.NUMBER },
    relationships: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          personName: { type: Type.STRING },
          relationshipType: { type: Type.STRING }
        },
        required: ["personName", "relationshipType"]
      }
    }
  },
  required: ["keyword", "lifespan", "birthplace", "biography", "achievements", "category", "latitude", "longitude", "relationships"]
};

export const PATH_PROMPT = (source: string, target: string, existingNames: string) => `你是一位极其博学的人文历史百科专家。请基于“六度分隔”理论，找出 "${source}" 和 "${target}" 之间【最短】且【最合理】的历史联系路径。
要求：
1. 【极简主义】：设法通过最少的人物节点建立联系。如果能用 3 个人连起来，就不要用 4 个人。
2. 【长度限制】：整条链条总人数（含起止点）建议在 3 到 5 人之间，绝对严禁超过 6 人。
3. 请严格返回一个 JSON 对象，必须包含 "chain" 字段，该字段为一个由对象组成的数组。
4. 链条必须以 "${source}" 开始，以 "${target}" 结束。
5. 数组每个元素必须严格包含两个字段: "name" (人物的标准中文译名) 和 "relationshipToPrevious" (与前一个人的关系描述)。
   - **避重就轻**：在选择中间节点人物时，优先使用以下馆藏中已有的人物，以增强馆内关联度并避免重复创建：[${existingNames.slice(0, 500)}]。
   - 如果必须引入新人物，请使用其【最标准】的中文译名。
6. **确保 name 字段内容为有效字符串，严禁返回 null 或 undefined**。
7. 第一个元素是 "${source}"，其 "relationshipToPrevious" 必须为空字符串 ""。
8. 后续每个元素是链条中的下一个人物，"relationshipToPrevious" 描述他与【前一个人】的关系。
9. 【重要】"relationshipToPrevious" 的内容必须在 20 到 30 个汉字之间，描述两人在历史时空中的逻辑联系。
10. 优先考虑：师生关系、著名的历史事件共事、思想直接继承、互为政敌、重大亲属关系或地理与时代的交集。必须是 [历史上真实存在] 的人物。
`;

export const PATH_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    chain: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          relationshipToPrevious: { type: Type.STRING }
        },
        required: ["name", "relationshipToPrevious"]
      }
    }
  },
  required: ["chain"]
};

export const VALIDATION_PROMPT = (name: string, existingNames: string) => `用户输入了一个名称或代称： "${name}"
请执行以下判断并返回 JSON 对象：
1. "normalizedName": 找出最符合该输入且最知名的历史人物标准中文译名（如 "Steve Jobs" 则转为 "史蒂夫·乔布斯"）。
   - **重要**：如果该人物在以下馆藏名单中，请务必返回名单中的精确名称以避免重复：[${existingNames.slice(0, 1000)}]。
   - 如果不在名单中，请返回该人物最公认的中文译名。
2. "accepted": 布尔值。只要是在世人物、敏感人物、虚构人物或非人物实体，都设为 false。真实历史人物设为 true。
3. "reason": 如果 accepted 为 false，请说明原因；如果为 true，请简洁描述该人物的历史地位（20字以内）。
确保返回的 JSON 严格包含 "accepted"、"normalizedName"、"reason" 三个字段。
`;

export const VALIDATION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    accepted: { type: Type.BOOLEAN },
    normalizedName: { type: Type.STRING },
    reason: { type: Type.STRING }
  },
  required: ["accepted", "normalizedName", "reason"]
};
