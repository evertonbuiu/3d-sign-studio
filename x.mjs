import fs from "fs";
import { dxfToShapes } from "./src/lib/sign/dxf.ts";
const s = dxfToShapes(fs.readFileSync("/tmp/t.dxf","utf8"), 100);
console.error("SHAPES", s.length, s.map(x => [x.getPoints(1).length, x.holes.length]));
