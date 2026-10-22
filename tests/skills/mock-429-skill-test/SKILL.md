---
name: mock-429-skill-test
description: Runs the red-green-refactor cycle. Writes a failing test, verifies it fails for the right reason, writes minimal code to pass, then refactors while green. Enforces the iron law that no production code is written without a failing test first.
metadata:
  model: mock-openai/mock-gpt-4o
---

A skill that swithes the model to mock gpt 4o which returns a 429 and triggers the model switching plugin.
