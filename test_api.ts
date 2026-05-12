import fetch from "node-fetch";

async function run() {
  const res = await fetch("http://localhost:3000/api/archive");
  const data = await res.text();
  console.log(data);
}
run();