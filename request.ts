import { VALIDATION_PROMPT, VALIDATION_SCHEMA } from "./src/services/aiService";

async function test() {
  const res = await fetch("http://localhost:3000/api/ai/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
        prompt: VALIDATION_PROMPT(["周杰伦"], ""), 
        responseFormat: "json",
        schema: VALIDATION_SCHEMA
    }),
  });
  console.log(res.status);
  const data = await res.json();
  const text = data.text;
  let parsed: any = {};
  try {
     let rawParsed = JSON.parse(text || "{}");
     if (Array.isArray(rawParsed) && rawParsed.length > 0) {
       parsed = rawParsed[0];
     } else {
       parsed = rawParsed;
     }
   } catch (e) {
     console.error("Failed to parse validation JSON:", text);
   }
   
   if (parsed.accepted === undefined) {
      console.error("Missing standard keys in AI response:", parsed);
      if ((parsed as any).result && (parsed as any).result.accepted !== undefined) {
         parsed = (parsed as any).result;
      } else {
         console.log({ accepted: false, reason: "AI 返回数据结构异常，缺少 accepted 标识" });
         return;
      }
   }
   console.log("FINAL", parsed);
}
test();
