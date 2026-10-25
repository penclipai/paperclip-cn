import {describe,expect,it} from "vitest";
import {environmentTaskOperationSchema} from "../src/environment-tasks.js";
const submit={kind:"submit",projectIds:[],bootstrapTicket:"synthetic",runner:{harness:"codex",protocolMin:1,protocolMax:3,runnerId:"runner",leaseId:"lease",runId:"run",sessionId:"session",turnId:"turn",itemId:"item"},
 launch:{runnerVersion:"fixture",runnerDigest:`sha256:${"a".repeat(64)}`,maxOutboxBytes:262144,p0ReserveBytes:65536,lifecyclePolicy:{mode:"warm",idleTimeoutMs:300000}}};
describe("task lifecycle policy",()=>{
 it("accepts bounded warm policy and the existing per-turn policy",()=>{
  expect(environmentTaskOperationSchema.parse(submit)).toEqual(submit);
  expect(environmentTaskOperationSchema.safeParse({...submit,launch:{...submit.launch,lifecyclePolicy:{mode:"per_turn",idleTimeoutMs:null}}}).success).toBe(true);
 });
 it.each([0,-1,86400001,null,1.5])("rejects invalid warm idle timeout %s",idleTimeoutMs=>{
  expect(environmentTaskOperationSchema.safeParse({...submit,launch:{...submit.launch,lifecyclePolicy:{mode:"warm",idleTimeoutMs}}}).success).toBe(false);
 });
});
