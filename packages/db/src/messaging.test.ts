import { describe, expect, it } from "vitest";
import { sequenceStepProgress } from "./messaging";

describe("sequenceStepProgress", () => {
  it("counts enrollments that have queued each step, including completed enrollments", () => {
    expect(sequenceStepProgress(3, [
      { nextStep: 0, count: 2 },
      { nextStep: 1, count: 4 },
      { nextStep: 3, count: 5 },
    ], [
      { stepPosition: 0, status: "sent", count: 7 },
      { stepPosition: 1, status: "failed", count: 2 },
      { stepPosition: 1, status: "queued", count: 3 },
    ])).toEqual([
      { step: 1, queued: 9, sent: 7, failed: 0, waiting: 0, replies: 0, responseRate: 0 },
      { step: 2, queued: 5, sent: 0, failed: 2, waiting: 3, replies: 0, responseRate: 0 },
      { step: 3, queued: 5, sent: 0, failed: 0, waiting: 0, replies: 0, responseRate: 0 },
    ]);
  });

  it("returns zero progress when no enrollments have queued a step", () => {
    expect(sequenceStepProgress(2, [{ nextStep: 0, count: 3 }], [])).toEqual([
      { step: 1, queued: 0, sent: 0, failed: 0, waiting: 0, replies: 0, responseRate: 0 },
      { step: 2, queued: 0, sent: 0, failed: 0, waiting: 0, replies: 0, responseRate: 0 },
    ]);
  });

  it("attributes replies to steps and computes response rate from sent messages", () => {
    expect(sequenceStepProgress(3, [
      { nextStep: 0, count: 3 },
      { nextStep: 1, count: 2 },
    ], [
      { stepPosition: 0, status: "sent", count: 10 },
      { stepPosition: 0, status: "failed", count: 2 },
      { stepPosition: 1, status: "sent", count: 4 },
    ], { 1: 3, 2: 1 })).toEqual([
      { step: 1, queued: 2, sent: 10, failed: 2, waiting: 0, replies: 3, responseRate: 30 },
      { step: 2, queued: 0, sent: 4, failed: 0, waiting: 0, replies: 1, responseRate: 25 },
      { step: 3, queued: 0, sent: 0, failed: 0, waiting: 0, replies: 0, responseRate: 0 },
    ]);
  });

  it("rounds the response rate to one decimal and is zero when nothing was sent", () => {
    expect(sequenceStepProgress(1, [{ nextStep: 0, count: 1 }], [
      { stepPosition: 0, status: "sent", count: 8 },
    ], { 1: 3 })).toEqual([{ step: 1, queued: 0, sent: 8, failed: 0, waiting: 0, replies: 3, responseRate: 37.5 }]);

    expect(sequenceStepProgress(1, [{ nextStep: 0, count: 1 }], [], { 1: 5 })).toEqual([{ step: 1, queued: 0, sent: 0, failed: 0, waiting: 0, replies: 5, responseRate: 0 }]);
  });
});
