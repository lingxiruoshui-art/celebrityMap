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

请严格返回以下格式的 JSON 对象：
{
  "keyword": "该人物最经典、最具代表性的一句人生格言",
  "lifespan": "如公元前571年-公元前471年或1879年-1955年",
  "birthplace": "出生地",
  "category": "从以下选择最合适的：[${categories.join("、")}]",
  "biography": "正规且诙谐幽默的传记。分3-4段。禁止使用大家好等开场白。",
  "achievements": ["成就1", "成就2"],
  "relationships": [
    {"personName": "标准中文译名", "relationshipType": "20-30字关系描述"}
  ],
  "latitude": 纬度数字,
  "longitude": 经度数字
}

特别要求：
1. relationships 中的人物必须是实名历史人物，优先包含：[${existingNames.slice(0, 500)}]。
2. 所有返回内容必须使用简体中文。
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

export const PATH_PROMPT = (source: string, target: string, existingNames: string) => `你是一位极其博学的人文历史百科专家。找出 "${source}" 和 "${target}" 之间【最短】且【最合理】的历史联系路径。

请严格返回以下格式的 JSON 对象：
{
  "chain": [
    { "name": "${source}", "relationshipToPrevious": "" },
    { "name": "中间人物1", "relationshipToPrevious": "与前一个人物的详细关系描述" },
    ...
    { "name": "${target}", "relationshipToPrevious": "与前一个人物的详细关系描述" }
  ]
}

要求：
1. 【极简主义】：必须采用最短路径。中间的人物（不包含起止点）最少可以是0个，最多不能超过5个。
2. 【直接沟通优先】：如果这两个人能够直接认识、交流或有直接历史交集（例如老子和孔子、李白和杜甫等），必须直接相连，中间**绝不能**经过其他任何人。
3. 避重就轻：优先使用以下馆藏中已有的人物：[${existingNames.slice(0, 500)}]。
4. relationshipToPrevious 的描述必须在 20 到 30 个汉字之间，描述与其前一个人的真实历史交集（师生/政敌/亲属等）。
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
请严格返回唯一的 JSON 对象，格式必须如下：
{
  "accepted": true 或 false，
  "normalizedName": "人物标准中文名",
  "reason": "判断理由"
}

规则：
1. "normalizedName": 找出最符合该输入且最知名的历史人物标准中文译名。
   - **重要**：如果该人物在以下馆藏名单中，请务必返回名单中的精确名称以避免重复：[${existingNames.slice(0, 1000)}]。
   - 如果不在名单中，请返回该人物最公认的中文译名。
2. "accepted": 布尔值。只要是在世人物、当代名人、敏感人物、虚构人物或非人物实体，都设为 false。真实历史人物设为 true。
3. "reason": 如果 accepted 为 false，说明原因；如果为 true，简洁描述该人物的历史地位（20字以内）。
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
