---
name: mock-429-subagent-test
description: creates a subagent and switches the model to mock-gpt-4o to test the model-switching plugin.
---

#Mock 429 Subagent Test

Safety
- Don’t edit plugin or configuration files.
- Don’t restart OpenCode.
- Run one subagent test per invocation. Multiple 429 log entries from retries are expected.
  Procedure
1. Check the mock provider and plugin with opencode api get /api/plugin. If the plugin isn’t active, stop.
2. Invoke one general subagent using mock-openai/mock-gpt-4o, with this prompt:
   For this test, make one harmless model response. Do not use tools, change files, or select another model. Reply with exactly mock-provider-test.
5. Wait for the subagent. A rate-limit error is expected.
6. Leave the subagent running so we can test a plugin that is supposed to step in and handle behaviour.
