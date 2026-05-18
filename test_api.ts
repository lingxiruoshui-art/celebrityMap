import fetch from "node-fetch";

async function run() {
  const adminPwd = process.env.ADMIN_PASSWORD || "admin";
  const res = await fetch("http://localhost:3000/api/admin/config", { headers: { "x-admin-password": adminPwd } });
  const data = await res.text();
  console.log("Status:", res.status);
  console.log("Headers:", res.headers.raw());
  console.log("Body:", data);
}
run();