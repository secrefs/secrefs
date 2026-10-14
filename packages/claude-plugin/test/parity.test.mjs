// The plugin carries its own copy of the reference grammar so it works
// without the library installed. This holds that copy to the library's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRef } from "../scripts/lib/project.mjs";

const PARSER = fileURLToPath(new URL("../../node/dist/parser.js", import.meta.url));

const CASES = [
  "sec://aws/prod/db#password",
  "sec://AWS-Prod/prod/db",
  "sec://vault/secret/data/stripe#nested.key",
  "sec://local/mock-db#password",
  "  sec://local/padded  ",
  "sec://bitwarden/7b2c1e0e-1111-2222-3333-444455556666",
  "sec://-bad/x",
  "sec://aws/",
  "sec://aws/a b",
  "sec://aws/a#b#c",
  "sec:/aws/x",
  "aws/prod/db",
  "",
];

test("parseRef agrees with @secrefs/node's parser", { skip: !existsSync(PARSER) && "packages/node is not built" }, async () => {
  const { tryParseSecretRef } = await import(PARSER);
  for (const raw of CASES) {
    const lib = tryParseSecretRef(raw);
    const ours = parseRef(raw);
    if (lib === null) {
      assert.ok(ours.error, `library rejects ${JSON.stringify(raw)}, plugin accepts it`);
    } else {
      assert.deepEqual(ours, { provider: lib.provider, path: lib.path, ...(lib.field ? { field: lib.field } : {}) }, raw);
    }
  }
});
