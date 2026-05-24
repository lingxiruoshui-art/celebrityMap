import { GoogleGenAI, Type, Schema } from "@google/genai";

let ai: GoogleGenAI | null = null;

export function getGemini(apiKeyOverride?: string): GoogleGenAI {
  if (!ai || apiKeyOverride) {
    // Note: process.env.GEMINI_API_KEY is handled by the platform in the browser
    const apiKey = apiKeyOverride || (typeof process !== "undefined" && process.env ? process.env.GEMINI_API_KEY : "") || "";
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
}

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
5. 绝对禁止选取或涉及任何中国近代政治家（如周恩来、孙中山、蒋介石等近代政治、革命或军事领导人物）或任何仍然在世的人（如刘德华等当代活跃仍健在的人）。
6. 如果候选人名单为空或实在无法找到合理和合规的联系，请返回空数组 []。

请严格返回以下格式的 JSON 数组：
[
  {"personName": "候选人姓名", "relationshipType": "20-30字关系描述，禁止换行和特殊符号"}
]

特别注意：
请确保仅返回合法的 JSON。所有包含双引号的值必须使用 \\" 转义。不要包含任何 markdown，不要加入回车换行。
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
