import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(projectRoot, "public");
const indexPath = path.join(publicDir, "index.html");
const adminDir = path.join(publicDir, "admin");
const adminIndexPath = path.join(adminDir, "index.html");
const configPath = path.join(publicDir, "supabase-config.js");
const checkConfig = process.argv.includes("--check-config");
const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || "").trim();

if (checkConfig && (!supabaseUrl || !supabaseAnonKey)) {
  console.error("Set the SUPABASE_URL and SUPABASE_ANON_KEY repository variables before deploying.");
  process.exit(1);
}

if (supabaseUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    console.error("SUPABASE_URL must be a valid absolute URL.");
    process.exit(1);
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    console.error("SUPABASE_URL must use HTTP or HTTPS.");
    process.exit(1);
  }
}

if (/^sb_secret_/i.test(supabaseAnonKey)) {
  console.error("Do not publish a Supabase secret/service-role key as SUPABASE_ANON_KEY.");
  process.exit(1);
}

if (supabaseAnonKey.startsWith("eyJ")) {
  try {
    const payload = JSON.parse(Buffer.from(supabaseAnonKey.split(".")[1], "base64url").toString("utf8"));
    if (payload.role === "service_role") {
      console.error("Do not publish a Supabase service-role key in the static site.");
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error("SUPABASE_ANON_KEY is not a valid JWT or publishable key.");
      process.exit(1);
    }
    throw error;
  }
}

const index = await readFile(indexPath, "utf8");
if (!index.includes('<base href="./">')) {
  console.error('Expected <base href="./"> in public/index.html to generate the /admin route.');
  process.exit(1);
}

await mkdir(adminDir, { recursive: true });
await writeFile(adminIndexPath, index.replace('<base href="./">', '<base href="../">'));
await writeFile(
  configPath,
  `globalThis.MFN_SUPABASE_CONFIG = Object.freeze(${JSON.stringify({
    url: supabaseUrl,
    anonKey: supabaseAnonKey
  })});\n`
);

console.log("Built the GitHub Pages /admin/ entry and Supabase public configuration.");
