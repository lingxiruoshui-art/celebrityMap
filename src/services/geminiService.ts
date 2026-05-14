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

export const ARCHIVE_PROMPT = (name: string, categories: string[], sampleNames?: string) => `
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
1. relationships 中的人物必须是实名历史人物。为了保持时空网络的连通性，请优先尝试关联那些能够显著增加该人物历史交叉度的知名人物${sampleNames ? `（例如：${sampleNames} 等）` : ""}。
2. 请务必使用广泛公认的学术标准中文译名，以确保数据一致性，避免重复录入。
3. 所有返回内容必须使用简体中文。
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

export const PATH_PROMPT = (source: string, target: string, sampleNames?: string) => `找出 "${source}" 和 "${target}" 之间的最短历史联系路径。要求：
1. 最短路径：中间人物0-5个。若两人有直接历史交集，则必须直接相连(0个中间人)。
2. 优先通过世界知名历史人物${sampleNames ? `(如: ${sampleNames})` : ""}联系。
3. 使用公认的标准中文全名。
4. relationshipToPrevious：20字以内极简概括两人真实历史交集。
请极速思考并直接返回合法的 JSON 对象。`;

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

export const VALIDATION_PROMPT = (names: string[], sampleNames?: string) => `辨识历史人物： ${names.map(n => `"${n}"`).join(' 和 ')}
请严格返回 JSON 对象，包含 results 数组，对应每个输入的人物。
注意：
- accepted：仅限真实已故历史人物为 true，其余(虚构、在世、非人类实体等)一律为 false。
- normalizedName：该人物公认的标准中文全名。参考现有风格：${sampleNames || "无"}。
- reason：极简描述其历史身份(限10字内)。

必须直接返回合法的 JSON，不要有多余的提示说明，要求极速响应。`;

export const VALIDATION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    results: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          accepted: { type: Type.BOOLEAN },
          normalizedName: { type: Type.STRING },
          reason: { type: Type.STRING }
        },
        required: ["name", "accepted", "normalizedName", "reason"]
      }
    }
  },
  required: ["results"]
};
