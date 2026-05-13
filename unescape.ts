import fs from "fs";
let c = fs.readFileSync("src/app.ts", "utf8");
c = c.replace(/<\\\\\/think>/g, '<\\/think>'); // Fix <\\/think> to <\/think>
fs.writeFileSync("src/app.ts", c);
