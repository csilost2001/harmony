import { describe, it, expect, beforeEach } from "vitest";
import { getAuthToken, isUnauthorizedClose, setAuthToken, wsUrlWithToken } from "./authToken";

describe("接続トークン", () => {
  beforeEach(() => { localStorage.clear(); });

  it("保存・取得・消去ができる", () => {
    expect(getAuthToken()).toBeNull();
    setAuthToken("abc");
    expect(getAuthToken()).toBe("abc");
    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
  });

  it("接続 URL に ?token= を付ける (トークンが無ければそのまま。特殊文字は符号化する)", () => {
    expect(wsUrlWithToken("ws://localhost:5179", null)).toBe("ws://localhost:5179");
    expect(wsUrlWithToken("ws://localhost:5179", "a b&c=d")).toBe("ws://localhost:5179/?token=a+b%26c%3Dd");
  });

  it("サーバが認証を求めて切断した close だけを見分ける", () => {
    expect(isUnauthorizedClose({ code: 1008, reason: "Unauthorized" })).toBe(true);
    expect(isUnauthorizedClose({ code: 1008, reason: "Forbidden" })).toBe(false);
    expect(isUnauthorizedClose({ code: 1006, reason: "" })).toBe(false);
  });
});
