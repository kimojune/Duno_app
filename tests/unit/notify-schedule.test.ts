import { readFileSync } from "node:fs";
import { createPublicKey, createVerify } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateNotifyKeys } from "../../scripts/notify-keys.mjs";
import { isDue, NOTIFY_WINDOW_MINUTES_DEFAULT, parseWindowMinutes, seoulMinuteOfDay } from "../../lib/push/due";
import { createVapidJwt } from "../../lib/push/vapid";

const DIR = path.resolve(__dirname, "../../docs/oneshot-v2/알림-예약");
const scheduleSql = readFileSync(path.join(DIR, "notify-cron-schedule.sql"), "utf8").replace(/\r\n/g, "\n");
const unscheduleSql = readFileSync(path.join(DIR, "notify-cron-unschedule.sql"), "utf8").replace(/\r\n/g, "\n");

/** 예약 SQL의 식에서 분 칸을 읽는다 */
function scheduleMinutes(): number[] {
  const m = /'(\d+(?:,\d+)*) \* \* \* \*'/.exec(scheduleSql);
  if (!m) throw new Error("no cron expression");
  return m[1].split(",").map(Number);
}

describe("알림 예약 하루 시뮬레이션 (d-214)", () => {
  const window = parseWindowMinutes(undefined);
  const targets = Array.from({ length: 48 }, (_, i) => i * 30); // 0:00 ~ 23:30, 자정 넘는 칸 포함
  const base = Date.UTC(2026, 10, 9, 15, 0); // 서울 11-10 00:00 (UTC+9)

  function countsForDelay(delay: number): number[] {
    const counts = targets.map(() => 0);
    for (let hour = 0; hour < 24; hour++) {
      for (const minute of scheduleMinutes()) {
        const run = new Date(base + (hour * 60 + minute + delay) * 60_000);
        const nowMinute = seoulMinuteOfDay(run);
        targets.forEach((t, i) => {
          if (isDue(t, nowMinute, window)) counts[i] += 1;
        });
      }
    }
    return counts;
  }

  it("창은 15이고 실행 분은 :01 :16 :31 :46이다", () => {
    expect(window).toBe(15);
    expect(scheduleMinutes()).toEqual([1, 16, 31, 46]);
  });
  it("30분 단위 시각 48개가 하루에 모두 정확히 한 번 걸린다(지연 0분)", () => {
    expect(targets).toHaveLength(48);
    expect(countsForDelay(0)).toEqual(targets.map(() => 1));
  });
  it("실행이 0~13분 늦게 닿아도(같은 지연이 하루 내내) 정확히 한 번이다", () => {
    for (let delay = 0; delay <= 13; delay++) expect(countsForDelay(delay), `delay ${delay}`).toEqual(targets.map(() => 1));
  });
  it("자정을 넘는 시각(23:30, 0:00)도 한 번씩 걸린다", () => {
    const counts = countsForDelay(7);
    expect(counts[0]).toBe(1); // 0:00
    expect(counts[47]).toBe(1); // 23:30
  });
});

describe("알림 키 스크립트 (d-214)", () => {
  const keys = generateNotifyKeys();
  const jwkOf = (publicKey: string) => {
    const pub = Buffer.from(publicKey, "base64url");
    return { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33, 65).toString("base64url") };
  };
  it("공개 키는 65바이트·첫 바이트 4, 비밀 키는 32바이트, 예약 비밀은 32바이트 이상 무작위", () => {
    const pub = Buffer.from(keys.publicKey, "base64url");
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(4);
    expect(Buffer.from(keys.privateKey, "base64url").length).toBe(32);
    expect(Buffer.from(keys.cronSecret, "base64url").length).toBeGreaterThanOrEqual(32);
    const again = generateNotifyKeys();
    expect(again.cronSecret).not.toBe(keys.cronSecret);
    expect(again.privateKey).not.toBe(keys.privateKey);
  });
  it("키를 200번 만들어도 길이가 모두 맞고 서명이 공개 키로 검증된다(값은 찍지 않는다)", () => {
    for (let i = 0; i < 200; i++) {
      const k = generateNotifyKeys();
      const pub = Buffer.from(k.publicKey, "base64url");
      expect(pub.length).toBe(65);
      expect(pub[0]).toBe(4);
      expect(Buffer.from(k.privateKey, "base64url").length).toBe(32);
      expect(Buffer.from(k.cronSecret, "base64url").length).toBeGreaterThanOrEqual(32);
      const jwt = createVapidJwt({ endpoint: "https://push.example.com/send/abc", subject: "mailto:dummy@example.com", publicKey: k.publicKey, privateKey: k.privateKey });
      const [header, payload, signature] = jwt.split(".");
      const ok = createVerify("SHA256")
        .update(`${header}.${payload}`)
        .verify({ key: createPublicKey({ key: jwkOf(k.publicKey), format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
      expect(ok).toBe(true);
    }
  });
  it("만든 키가 앱 서명 코드(createVapidJwt)를 통과하고 서명이 공개 키로 검증된다", () => {
    const jwt = createVapidJwt({ endpoint: "https://push.example.com/send/abc", subject: "mailto:dummy@example.com", publicKey: keys.publicKey, privateKey: keys.privateKey });
    const [header, payload, signature] = jwt.split(".");
    const verify = (publicKey: string) =>
      createVerify("SHA256")
        .update(`${header}.${payload}`)
        .verify({ key: createPublicKey({ key: jwkOf(publicKey), format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    expect(verify(keys.publicKey)).toBe(true);
    expect(verify(generateNotifyKeys().publicKey)).toBe(false); // 다른 키로는 검증이 안 된다
  });
});

describe("알림 예약 SQL (d-214)", () => {
  it("실행 식이 1,16,31,46 * * * * 이고 코드의 기본 창이 15다", () => {
    expect(scheduleSql).toContain("'1,16,31,46 * * * *'");
    expect(NOTIFY_WINDOW_MINUTES_DEFAULT).toBe(15);
    const minutes = scheduleMinutes();
    minutes.forEach((m, i) => expect((minutes[(i + 1) % minutes.length] - m + 60) % 60).toBe(NOTIFY_WINDOW_MINUTES_DEFAULT));
  });
  it("작업 이름 하나, pg_net http_post, Vault 이름으로만 주소·비밀을 읽고 둘 다 있을 때만 보낸다", () => {
    expect(scheduleSql).toContain("cron.schedule(\n  'duno-notify-tick'");
    expect(scheduleSql).toContain("net.http_post");
    expect(scheduleSql).toContain("vault.decrypted_secrets");
    expect(scheduleSql).toContain("'duno_notify_tick_url'");
    expect(scheduleSql).toContain("'duno_cron_secret'");
    expect(scheduleSql).toContain("'Bearer ' || s.secret");
    expect(scheduleSql).toContain("timeout_milliseconds := 30000");
    expect(scheduleSql).toMatch(/where nullif\(btrim\(s\.url\), ''\) is not null\s+and nullif\(btrim\(s\.secret\), ''\) is not null/);
    expect(scheduleSql).toContain("SQL 미실행");
  });
  it("되돌리는 SQL은 그 작업을 cron.unschedule로 지운다", () => {
    expect(unscheduleSql).toContain("cron.unschedule(jobid)");
    expect(unscheduleSql).toContain("'duno-notify-tick'");
  });
  it("SQL 파일에 비밀 값처럼 보이는 문자열이 없다", () => {
    for (const sql of [scheduleSql, unscheduleSql]) {
      expect(sql).not.toMatch(/https?:\/\/[^\s<]/); // 주소는 Vault에서만(「https://<배포 주소>」 안내 글은 꺾쇠로 시작해 제외)
      expect(sql).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // JWT
      expect(sql).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9]/);
      expect(sql).not.toMatch(/[A-Za-z0-9_-]{32,}/); // 긴 무작위 문자열
      expect(sql).not.toMatch(/Bearer\s+[A-Za-z0-9]/); // 머리글에 값을 직접 적지 않는다
    }
  });
});
