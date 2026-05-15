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
${bioSnippet ? `参考背景资料（身份线索）：${bioSnippet}\n\n注意：该人物的身份已通过背景资料确认，无须再次验证或标准化姓名。` : ""}

要求：
${bioSnippet ? "" : `- accepted：仅限真实已故客观存在的历史人物为 true。严禁包含神话人物、民间传说人物（如孟姜女、神农氏等）、虚构角色或在世人物，这类一律为 false。
- reason：极简描述其历史身份(限10字内)。
- standardChineseName：该人物最权威、最广泛公认的学术标准中文全名（外国人名请使用标准译名，中国古人请使用姓名而非号或字）。`}
- keyword：该人物最经典、最具代表性的一句人生格言短语
- lifespan：如公元前571年-公元前471年或1879年-1955年
- birthplace：出生地

请严格返回以下格式的 JSON 对象：
{
${bioSnippet ? "" : `  "accepted": true/false,
  "reason": "历史身份简述",
  "standardChineseName": "标准中文全名",`}
  "keyword": "该人物最经典、最具代表性的一句人生格言",
  "lifespan": "如公元前571年-公元前471年或1879年-1955年",
  "birthplace": "出生地",
  "category": "${bioSnippet ? `参考背景资料提取角色身份，或从以下选择：[${categories.join("、")}]` : `从以下选择最合适的：[${categories.join("、")}]`}",
  "biography": "正规且诙谐幽默的传记。绝对不要写成1大段，必须分段，至少2段，至多3段（各段用\\n\\n分隔），不少于300字。禁止使用大家好等开场白。",
  "achievements": ["成就1", "成就2"],
  "relationships": [
    {"personName": "标准中文全名", "relationshipType": "20-30字关系描述"}
  ],
  "latitude": 纬度数字,
  "longitude": 经度数字
}

特别要求：
1. relationships 中提供3~5个人物，必须是真实的已故历史人物（严禁出现神话、民间传说、虚构小说中的人物，如孟姜女、女娲等），且为中国老百姓家喻户晓的名字。不需要有强烈的交集，可以是弱关联，比如言论中谈到、思想上有继承、同一流派、参加过同一社团等等，只要能扯上关系就行。
2. 请务必使用广泛公认的学术标准中文译名，以确保数据一致性，避免重复录入。
3. biography 字段绝对不能写成一大段，必须分成 2 到 3 段（使用 \\n\\n 进行真正的分段），结构清晰。
4. 所有返回内容必须使用简体中文。
`;

export const ARCHIVE_SCHEMA = (hasBio: boolean): Schema => ({
  type: Type.OBJECT,
  properties: {
    ...(!hasBio ? {
      accepted: { type: Type.BOOLEAN },
      reason: { type: Type.STRING },
      standardChineseName: { type: Type.STRING },
    } : {}),
    keyword: { type: Type.STRING },
    lifespan: { type: Type.STRING },
    birthplace: { type: Type.STRING },
    category: { type: Type.STRING },
    biography: { type: Type.STRING, description: "正规且诙谐幽默的传记。绝对不要写成1大段，必须分段，至少2段，至多3段（各段用\\n\\n分隔），不少于300字。" },
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

export const EXPAND_CONNECTIONS_PROMPT = (name: string, bio: string, candidates: string[]) => `
你是一位历史关系网络专家。
正在为人物 "${name}" 寻找新的历史关联。
人物背景: ${bio}

潜在候选人名单 (库中已有的已知人物):
[${candidates.join("、")}]

要求：
1. 从候选人名单中挑选 1~3 位与 "${name}" 可能存在联系的人物。
2. 联系可以是直接的 (如师生、同僚、劲敌) 也可以是间接的 (如思想继承、处于同一历史大事件、被其文章评论、共同被后世某位文豪提及等)。
3. 给出的关系描述必须详实且有历史感，控制在 20-30 字。
4. 必须只从给定的“候选人名单”中选择，严禁虚构他人。
5. 如果候选人名单为空或实在无法找到合理联系，请返回空数组 []。

请严格返回以下格式的 JSON 数组：
[
  {"personName": "候选人姓名", "relationshipType": "20-30字关系描述"}
]
`;

export const EXPAND_CONNECTIONS_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      personName: { type: Type.STRING },
      relationshipType: { type: Type.STRING }
    },
    required: ["personName", "relationshipType"]
  }
};
