import fs from "fs";
import M from "dxf-parser";
const P = M.default || M;
const t = fs.readFileSync("/tmp/t.dxf","utf8").replace(/\r\n?/g,"\n").replace(/\s+$/,"");
const d = new P().parseSync(t);
fs.writeFileSync("/tmp/out.json", JSON.stringify(d?.entities ?? null, null, 1));
