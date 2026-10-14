import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { findMeetingUrl } from "../apps/mobile/lib/meetingUrl.ts";

// Home shows "Join call" on a scheduled item whose notes carry a call link.
describe("findMeetingUrl", () => {
  test("finds a plain Meet, Zoom or Teams link", () => {
    assert.equal(findMeetingUrl("https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
    assert.equal(findMeetingUrl("Join: https://zoom.us/j/123456789?pwd=abc"), "https://zoom.us/j/123456789?pwd=abc");
    assert.equal(
      findMeetingUrl("Call https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0 today"),
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0",
    );
    assert.equal(findMeetingUrl("http://teams.live.com/meet/9876"), "http://teams.live.com/meet/9876");
  });

  test("accepts a subdomain of the call host", () => {
    assert.equal(findMeetingUrl("https://us02web.zoom.us/j/8888"), "https://us02web.zoom.us/j/8888");
  });

  test("stops at the end of the link", () => {
    assert.equal(findMeetingUrl("(https://meet.google.com/abc-defg-hij)"), "https://meet.google.com/abc-defg-hij");
    assert.equal(findMeetingUrl("notes\nhttps://meet.google.com/abc-defg-hij\nagenda"), "https://meet.google.com/abc-defg-hij");
  });

  test("ignores links that only mention a call host", () => {
    assert.equal(findMeetingUrl("https://example.com/redirect?to=meet.google.com"), null);
    assert.equal(findMeetingUrl("https://notzoom.us/j/1"), null);
    assert.equal(findMeetingUrl("https://zoom.us.example.com/j/1"), null);
    assert.equal(findMeetingUrl("meet.google.com/abc without a scheme"), null);
    assert.equal(findMeetingUrl(""), null);
    assert.equal(findMeetingUrl(null), null);
  });
});
