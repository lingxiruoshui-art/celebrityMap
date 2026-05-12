
import dotenv from "dotenv";
import fs from "fs";
dotenv.config();
if (fs.existsSync(".env.example")) {
  dotenv.config({ path: ".env.example" });
}
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY);
console.log("API_KEY:", process.env.API_KEY);
console.log("GOOGLE_API_KEY:", process.env.GOOGLE_API_KEY);
