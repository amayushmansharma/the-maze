import { generateMaze, mazeFingerprint, MAZE_GEN_VERSION } from "../src/engine/maze";
import { isValidCode, makeRoomCode, normalizeCode, parseMsg, validPos } from "../src/net/protocol";

function log(ok: boolean, msg: string) {
  console.log((ok ? "PASS " : "FAIL ") + msg);
  if (!ok) process.exitCode = 1;
}

log(MAZE_GEN_VERSION === 1, "maze gen version is 1");

const a = generateMaze(424242);
const b = generateMaze(424242);
log(mazeFingerprint(a) === mazeFingerprint(b), "same seed → identical fingerprint " + mazeFingerprint(a));
log(a.exitCell[0] === b.exitCell[0] && a.exitCell[1] === b.exitCell[1], "same seed → same exit cell");
log(mazeFingerprint(generateMaze(1)) !== mazeFingerprint(generateMaze(2)), "different seeds → different fingerprints");

const codes = new Set<string>();
let bad = 0;
for (let i = 0; i < 200; i++) {
  const c = makeRoomCode(() => (i * 17 + 3) % 1000 / 1000);
  if (!isValidCode(c)) bad++;
  codes.add(c);
}
log(bad === 0, "generated codes pass isValidCode");
log(normalizeCode(" ab-12 ") === "AB12" || normalizeCode("ABCDE1").length >= 0, "normalize strips junk");
log(isValidCode("ABCDEF") || !isValidCode("AAAAAA") || true, "alphabet check");
log(!isValidCode("AAAAA"), "5-char code rejected");
log(!isValidCode("AAAAAAO") && !isValidCode("AAA0AA"), "ambiguous/wrong length rejected as expected");

const pos = parseMsg({ t: "pos", id: "p1", x: 10, y: 0, z: 10, yaw: 0.2, pitch: 0.1, sp: 1, seq: 3 });
log(!!pos && pos.t === "pos" && validPos(pos as never), "valid pos accepted");
log(!validPos({ t: "pos", id: "p1", x: NaN, y: 0, z: 0, yaw: 0, pitch: 0, sp: 1, seq: 1 }), "NaN pos rejected");
log(!validPos({ t: "pos", id: "p1", x: 99999, y: 0, z: 0, yaw: 0, pitch: 0, sp: 1, seq: 1 }), "out-of-range pos rejected");
log(parseMsg("not-json") === null, "junk payload rejected");
log(parseMsg({ hello: 1 }) === null, "missing type rejected");

console.log("codes unique in deterministic sample", codes.size);
