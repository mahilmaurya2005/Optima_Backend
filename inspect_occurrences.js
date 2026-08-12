const fs = require("fs");
const path = require("path");

const roots = ["controllers", "utils"];
const needle = process.argv[2] || "totalAmountWithDelivery";

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!full.endsWith(".js")) continue;

    const content = fs.readFileSync(full, "utf8");
    let from = 0;
    let found = false;
    while (true) {
      const idx = content.indexOf(needle, from);
      if (idx === -1) break;
      if (!found) {
        console.log(`FILE: ${full}`);
        found = true;
      }
      console.log(content.slice(Math.max(0, idx - 250), Math.min(content.length, idx + 450)));
      console.log("\n====\n");
      from = idx + needle.length;
    }
  }
}

for (const root of roots) {
  if (fs.existsSync(root)) walk(root);
}
