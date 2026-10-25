import {expect,it} from "vitest";
import {resolveRunnerEnvironmentForRun} from "./runner-environment-lifecycle.js";
it("opts Codex plugin tasks into warm retention without opting ACPX in",()=>{
 const environment={driver:"plugin" as const,config:{pluginKey:"fixture",driverKey:"tasks",driverConfig:{}}};
 expect(resolveRunnerEnvironmentForRun(environment,"paperclip_runner",{provider:"codex",lifecycleMode:"warm",idleTimeoutMs:1234})).toMatchObject({config:{runnerLifecycleMode:"warm",runnerIdleTimeoutMs:1234}});
 expect(resolveRunnerEnvironmentForRun(environment,"paperclip_runner",{provider:"acpx",lifecycleMode:"warm"})).toMatchObject({config:{runnerLifecycleMode:"per_turn"}});
 expect(environment.config).not.toHaveProperty("runnerLifecycleMode");
});
