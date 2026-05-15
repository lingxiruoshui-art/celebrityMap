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

export const ARCHIVE_PROMPT = (name: string, categories: string[], sampleNames?: string, bioSnippet?: string) => `
你是一位研究历史人物的传记专家。请为人物 "${name}" 撰写一份既有历史厚度又风趣幽默的传记。
${bioSnippet ? `参考背景资料：${bioSnippet}` : ""}

要求：
${bioSnippet ? "" : `- accepted：仅限真实已故历史人物为 true，其余(虚构、在世、非人类实体等)一律为 false。
- reason：极简描述其历史身份(限10字内)。`}
- standardChineseName：该人物最权威、最广泛公认的学术标准中文全名（外国人名请使用标准译名，中国古人请使用姓名而非号或字）。

请严格返回以下格式的 JSON 对象：
{
${bioSnippet ? "" : `  "accepted": true/false,
  "reason": "历史身份简述",`}
  "standardChineseName": "标准中文全名",
  "keyword": "该人物最经典、最具代表性的一句人生格言",
  "lifespan": "如公元前571年-公元前471年或1879年-1955年",
  "birthplace": "出生地",
  "category": "${bioSnippet ? `参考背景资料提取角色身份，或从以下选择：[${categories.join("、")}]` : `从以下选择最合适的：[${categories.join("、")}]`}",
  "biography": "正规且诙谐幽默的传记。分3-4段，不少于300字。禁止使用大家好等开场白。",
  "achievements": ["成就1", "成就2"],
  "relationships": [
    {"personName": "标准中文全名", "relationshipType": "20-30字关系描述"}
  ],
  "latitude": 纬度数字,
  "longitude": 经度数字
}

特别要求：
1. relationships 中提供3~5个人物，必须是实名历史人物且为中国老百姓家喻户晓的名字。不需要有强烈的交集，可以是弱关联，比如言论中谈到、思想上有继承、同一流派、参加过同一社团等等，只要能扯上关系就行。
2. 请务必使用广泛公认的学术标准中文译名，以确保数据一致性，避免重复录入。
3. 所有返回内容必须使用简体中文。
`;

export const ARCHIVE_SCHEMA = (hasBio: boolean): Schema => ({
  type: Type.OBJECT,
  properties: {
    ...(!hasBio ? {
      accepted: { type: Type.BOOLEAN },
      reason: { type: Type.STRING },
    } : {}),
    standardChineseName: { type: Type.STRING },
    keyword: { type: Type.STRING },
    lifespan: { type: Type.STRING },
    birthplace: { type: Type.STRING },
    category: { type: Type.STRING },
    biography: { type: Type.STRING },
    achievements: { type: Type.ARRAY, items: { type: Type.STRING } },
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
  required: [
    ...(!hasBio ? ["accepted", "reason"] : []), 
    "standardChineseName", "keyword", "lifespan", "birthplace", "biography", "achievements", "category", "latitude", "longitude", "relationships"
  ]
});
