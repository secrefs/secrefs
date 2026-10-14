import { test } from "node:test";
import assert from "node:assert/strict";
import { findLiteralSecrets, isEnvLikeFile, isSensitiveKey } from "../scripts/lib/detect.mjs";

// Fixtures are assembled at run time so this file never contains a
// literal token itself (it would trip the plugin's own guard, and every
// other scanner pointed at this repository).
const AWS_KEY = ["AKIA", "Z7Q3", "LPXN", "4M2K", "WT8B"].join("");
const GH_TOKEN = "ghp_" + "a1B2c3D4e5F6g7H8i9J0".repeat(2);
const PG_URL = "postgres://app:" + "s3cr3tPassw0rd" + "@db.internal:5432/app";

test("flags token formats in any file, without returning the value", () => {
  const findings = findLiteralSecrets(`const k = "${AWS_KEY}";\nconst t = "${GH_TOKEN}";`, "src/app.ts");
  assert.deepEqual(
    findings.map((f) => f.kind),
    ["AWS access key ID", "GitHub token"],
  );
  assert.ok(!JSON.stringify(findings).includes(AWS_KEY));
  assert.ok(!JSON.stringify(findings).includes(GH_TOKEN));
});

test("flags a URL with an inline password, but not a placeholder password", () => {
  assert.equal(findLiteralSecrets(`DATABASE_URL=${PG_URL}`, ".env").length, 1);
  assert.equal(findLiteralSecrets("DATABASE_URL=postgres://app:${DB_PASSWORD}@db/app", ".env").length, 0);
  assert.equal(findLiteralSecrets("url: postgres://user:password@localhost/app", "docker-compose.yml").length, 0);
});

test("flags credential variables with literal values in env files only", () => {
  const env = "DB_PASSWORD=hunter2hunter2\nAPI_KEY='abcdef123456'\nexport STRIPE_SECRET=\"zzz999zzz999\"";
  const findings = findLiteralSecrets(env, "/repo/.env.production");
  assert.deepEqual(findings.map((f) => f.key), ["DB_PASSWORD", "API_KEY", "STRIPE_SECRET"]);
  assert.equal(findLiteralSecrets(env, "src/config.ts").length, 0);
});

test("lets references, interpolation, placeholders and non-secret names through", () => {
  const env = [
    "DB_PASSWORD=sec://aws/prod/db#password",
    'API_KEY="sec://vault/secret/data/api#key"',
    "GITHUB_TOKEN=${GITHUB_TOKEN}",
    "SESSION_SECRET=changeme",
    "WEBHOOK_SECRET=<your-webhook-secret>",
    "STRIPE_KEY=",
    "TOKEN_ENV=BWS_ACCESS_TOKEN",
    "AWS_ACCESS_KEY_ID_FILE=/run/secrets/aws",
    "SECRET_MANAGER_REGION=us-east-1",
    "LOG_LEVEL=debug",
  ].join("\n");
  assert.deepEqual(findLiteralSecrets(env, ".env"), []);
});

test("a secrefs:allow comment exempts its line", () => {
  assert.equal(findLiteralSecrets(`const fixture = "${AWS_KEY}"; // secrefs:allow test fixture`, "a.test.ts").length, 0);
});

test("flags a private key block", () => {
  const pem = ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ") + "\nMIIE...\n-----END RSA PRIVATE KEY-----";
  assert.equal(findLiteralSecrets(pem, "key.pem")[0].kind, "private key");
});

test("env-file and key-name helpers", () => {
  for (const f of [".env", ".env.local", "/x/.env.production", "prod.env", ".envrc"]) assert.ok(isEnvLikeFile(f), f);
  for (const f of ["env.ts", "environment.md", ".envelope"]) assert.ok(!isEnvLikeFile(f), f);
  assert.ok(isSensitiveKey("DB_PASSWORD"));
  assert.ok(isSensitiveKey("openai.api-key"));
  assert.ok(!isSensitiveKey("BWS_TOKEN_ENV"));
  assert.ok(!isSensitiveKey("AWS_ACCESS_KEY_ID"));
});
