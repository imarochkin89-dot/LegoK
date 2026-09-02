import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticateBasic,
  createPasswordRecord,
  generatePassword,
  publicOrigin,
  trustedIdentityHeaders,
  validateIPv4Network,
  validateHost,
  verifyPassword,
} from "../runtime/config-tool.mjs";
import { createLocalWranglerConfig, isClientAllowed, sanitizeForwardHeaders } from "../runtime/server.mjs";

test("DNS names are normalized and invalid hostnames are rejected", () => {
  assert.equal(validateHost("Planner.Example.Test."), "planner.example.test");
  assert.throws(() => validateHost("localhost"));
  assert.throws(() => validateHost("bad host.example"));
});

test("password records verify without storing plaintext", () => {
  const password = generatePassword();
  const record = createPasswordRecord(password);
  assert.equal(record.algorithm, "pbkdf2-sha256");
  assert.equal(JSON.stringify(record).includes(password), false);
  assert.equal(verifyPassword(password, record), true);
  assert.equal(verifyPassword(`${password}x`, record), false);
});

test("Basic authentication maps a local account to trusted identity headers", () => {
  const password = "Very-Strong-Local-Password";
  const user = { email: "owner@example.test", displayName: "Project Owner", enabled: true, password: createPasswordRecord(password) };
  const authorization = `Basic ${Buffer.from(`${user.email}:${password}`).toString("base64")}`;
  assert.equal(authenticateBasic(authorization, [user]), user);
  assert.deepEqual(trustedIdentityHeaders(user), {
    "oai-authenticated-user-email": user.email,
    "oai-authenticated-user-name": user.displayName,
    "oai-authenticated-user-full-name": "Project%20Owner",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  });
});

test("untrusted identity and proxy headers are replaced", () => {
  const user = { email: "owner@example.test", displayName: "Owner" };
  const headers = sanitizeForwardHeaders({
    authorization: "Basic attacker",
    "oai-authenticated-user-email": "attacker@example.test",
    "x-forwarded-for": "203.0.113.99",
    "cf-connecting-ip": "203.0.113.99",
    "content-type": "application/json",
  }, user, "192.0.2.5");
  assert.equal(headers.authorization, undefined);
  assert.equal(headers["oai-authenticated-user-email"], user.email);
  assert.equal(headers["x-forwarded-for"], "192.0.2.5");
  assert.equal(headers["cf-connecting-ip"], "192.0.2.5");
  assert.equal(headers["content-type"], "application/json");
});

test("Planner and Portal receive separate local storage bindings", () => {
  const base = { main: "index.js", assets: { directory: "../client" } };
  const planner = createLocalWranglerConfig(base, {
    name: "planner",
    databaseName: "planner-db",
    databaseId: "11111111-1111-4111-8111-111111111111",
    bucketName: "planner-files",
    vars: { PUBLIC_SHARE_ORIGIN: publicOrigin("portal.example.test") },
  });
  const portal = createLocalWranglerConfig(base, {
    name: "portal",
    databaseName: "portal-db",
    databaseId: "22222222-2222-4222-8222-222222222222",
    bucketName: "portal-files",
    vars: { PLANNER_ORIGIN: publicOrigin("planner.example.test", 8443) },
  });
  assert.notEqual(planner.d1_databases[0].database_id, portal.d1_databases[0].database_id);
  assert.notEqual(planner.r2_buckets[0].bucket_name, portal.r2_buckets[0].bucket_name);
  assert.equal(planner.vars.PUBLIC_SHARE_ORIGIN, "https://portal.example.test");
  assert.equal(portal.vars.PLANNER_ORIGIN, "https://planner.example.test:8443");
});

test("IPv4 VLAN allowlist accepts only configured networks and loopback", () => {
  const networks = [validateIPv4Network("192.0.2.0/24"), validateIPv4Network("198.51.100.16/28")];
  assert.equal(isClientAllowed("::ffff:192.0.2.42", networks), true);
  assert.equal(isClientAllowed("198.51.100.31", networks), true);
  assert.equal(isClientAllowed("198.51.100.32", networks), false);
  assert.equal(isClientAllowed("203.0.113.5", networks), false);
  assert.equal(isClientAllowed("127.0.0.1", networks), true);
  assert.throws(() => validateIPv4Network("192.0.2.999/24"));
});
