import assert from "node:assert/strict";
import test from "node:test";

import { Effect, Logger } from "effect";

import plugin from "./model-switch-on-failure.ts";

const RESUME_PROMPT = "Resume the most recent unanswered request using the current conversation context and available tools. Avoid repeating completed work.";

function retryEvent(overrides = {}) {
    return {
        sessionID: "session-test",
        model: { providerID: "original-provider", id: "original-model" },
        error: { status: 429 },
        attempt: 3,
        decision: { retry: true, delay: 100 },
        ...overrides,
    };
}

async function withPlugin(options, verify, failures = {}) {
    const hooks = new Map();
    const calls = [];
    const logs = [];
    const context = {
        app: { version: "test" },
        options,
        session: {
            hook: (name, callback) => Effect.sync(() => hooks.set(name, callback)),
            switchModel: (request) => Effect.gen(function* () {
                failures.observeSwitch?.();
                calls.push({ operation: "switchModel", request });
                if (failures.switchModel) yield* Effect.fail(failures.switchModel);
            }),
            prompt: (request) => Effect.gen(function* () {
                calls.push({ operation: "prompt", request });
                if (failures.prompt) yield* Effect.fail(failures.prompt);
            }),
        },
    };
    const logger = Logger.make((entry) => logs.push(entry));
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* plugin.effect(context);
        yield* verify({ hooks, calls, logs });
    })).pipe(Effect.provide(Logger.layer([logger]))));
}

test("uses the configured fallback model", async () => {
    await withPlugin({ fallbackModel: "anthropic/claude-test" }, ({ hooks, calls }) => Effect.gen(function* () {
        yield* hooks.get("retry")(retryEvent());
        assert.deepEqual(calls[0].request.model, { providerID: "anthropic", id: "claude-test" });
    }));
});

for (const options of [{}, { fallbackModel: undefined }]) {
    test(`uses the default fallback when the option is ${Object.hasOwn(options, "fallbackModel") ? "undefined" : "omitted"}`, async () => {
        await withPlugin(options, ({ hooks, calls, logs }) => Effect.gen(function* () {
            yield* hooks.get("retry")(retryEvent());
            assert.deepEqual(calls[0].request.model, { providerID: "openai", id: "gpt-6-luna" });
            assert.equal(logs.filter((entry) => entry.logLevel === "Error").length, 0);
        }));
    });
}

test("retains the plugin identifier", () => {
    assert.equal(plugin.id, "model-fallback-with-test");
});

test("reads the fallback option once during initialisation", async () => {
    let reads = 0;
    const options = {
        get fallbackModel() {
            reads += 1;
            return reads === 1 ? "anthropic/claude-test" : "unexpected/model";
        },
    };
    await withPlugin(options, ({ hooks, calls }) => Effect.gen(function* () {
        yield* hooks.get("retry")(retryEvent());
        yield* hooks.get("retry")(retryEvent());
        assert.equal(reads, 1);
        assert.deepEqual(calls.filter((call) => call.operation === "switchModel").map((call) => call.request.model), [
            { providerID: "anthropic", id: "claude-test" },
            { providerID: "anthropic", id: "claude-test" },
        ]);
    }));
});

test("leaves non-429 retry events unchanged", async () => {
    await withPlugin({}, ({ hooks, calls }) => Effect.gen(function* () {
        for (const retry of [true, false]) {
            const event = retryEvent({ error: { status: 503 }, decision: retry ? { retry, delay: 123 } : { retry } });
            const originalDecision = event.decision;
            yield* hooks.get("retry")(event);
            assert.equal(event.decision, originalDecision);
        }
        assert.deepEqual(calls, []);
    }));
});

for (const retry of [true, false]) {
    test(`preserves early retry permission when retry is ${retry}`, async () => {
        await withPlugin({}, ({ hooks, calls }) => Effect.gen(function* () {
            for (const attempt of [0, 1, 2]) {
                const event = retryEvent({ attempt, decision: retry ? { retry, delay: 123 } : { retry } });
                const originalDecision = event.decision;
                yield* hooks.get("retry")(event);
                assert.deepEqual(event.decision, retry ? { retry: true, delay: 60_000 } : { retry: false });
                if (!retry) assert.equal(event.decision, originalDecision);
            }
            assert.deepEqual(calls, []);
        }));
    });

    test(`preserves configured fallback retry permission when retry is ${retry}`, async () => {
        await withPlugin({ fallbackModel: "anthropic/claude-test" }, ({ hooks, calls }) => Effect.gen(function* () {
            const event = retryEvent({ model: { providerID: "anthropic", id: "claude-test" }, attempt: 5, decision: retry ? { retry, delay: 123 } : { retry } });
            const originalDecision = event.decision;
            yield* hooks.get("retry")(event);
            assert.deepEqual(event.decision, retry ? { retry: true, delay: 60_000 } : { retry: false });
            if (!retry) assert.equal(event.decision, originalDecision);
            assert.deepEqual(calls, []);
        }));
    });
}

test("switches when only the model ID matches the fallback", async () => {
    await withPlugin({ fallbackModel: "anthropic/claude-test" }, ({ hooks, calls }) => Effect.gen(function* () {
        yield* hooks.get("retry")(retryEvent({ model: { providerID: "other-provider", id: "claude-test" } }));
        assert.deepEqual(calls[0].request.model, { providerID: "anthropic", id: "claude-test" });
    }));
});

for (const attempt of [3, 5]) {
    for (const retry of [true, false]) {
        test(`switches before queuing the resume prompt at attempt ${attempt} with retry ${retry}`, async () => {
            const event = retryEvent({ attempt, decision: retry ? { retry, delay: 123 } : { retry } });
            await withPlugin({ fallbackModel: "anthropic/claude-test" }, ({ hooks, calls }) => Effect.gen(function* () {
                yield* hooks.get("retry")(event);
                assert.deepEqual(event.decision, { retry: false });
                assert.deepEqual(calls, [
                    { operation: "switchModel", request: { sessionID: event.sessionID, model: { providerID: "anthropic", id: "claude-test" } } },
                    { operation: "prompt", request: { sessionID: event.sessionID, text: RESUME_PROMPT, delivery: "queue" } },
                ]);
            }), { observeSwitch: () => assert.deepEqual(event.decision, { retry: false }) });
        });
    }
}

for (const operation of ["switchModel", "prompt"]) {
    test(`catches ${operation} failures without failing the retry hook`, async () => {
        const failure = new Error(`${operation} failed`);
        await withPlugin({}, ({ hooks, calls, logs }) => Effect.gen(function* () {
            const event = retryEvent();
            yield* hooks.get("retry")(event);
            assert.deepEqual(event.decision, { retry: false });
            assert.deepEqual(calls.map((call) => call.operation), operation === "switchModel" ? ["switchModel"] : ["switchModel", "prompt"]);
            const errors = logs.filter((entry) => entry.logLevel === "Error");
            assert.equal(errors.length, 1);
            assert.equal(errors[0].message[0], "[model-fallback-test] Failed to switch to fallback model");
            assert.deepEqual(errors[0].message[1], { error: String(failure) });
        }), { [operation]: failure });
    });
}

for (const options of [{}, { fallbackModel: null }]) {
    test(`keeps HTTP 429 logging active with ${options.fallbackModel === null ? "invalid" : "default"} configuration`, async () => {
        await withPlugin(options, ({ hooks, logs }) => Effect.gen(function* () {
            yield* hooks.get("http.response")({ response: new Response(null, { status: 200 }) });
            yield* hooks.get("http.response")({ response: new Response(null, { status: 429 }) });
            const caughtResponses = logs.filter((entry) => entry.message[0] === "[model-fallback-test] Caught 429 response!");
            assert.equal(caughtResponses.length, 1);
            assert.equal(caughtResponses[0].logLevel, "Info");
            assert.deepEqual(caughtResponses[0].message[1], { status: 429 });
        }));
    });
}

test("preserves further slashes in namespaced model IDs", async () => {
    await withPlugin({ fallbackModel: "gateway/organisation/model" }, ({ hooks, calls }) => Effect.gen(function* () {
        yield* hooks.get("retry")(retryEvent());
        assert.deepEqual(calls[0].request.model, { providerID: "gateway", id: "organisation/model" });
    }));
});

test("disables fallback handling for malformed configuration without failing initialisation", async () => {
    const invalidOptions = [null, 42, false, {}, [], "", "openai", "/model", "openai/", " openai/model", "openai/model ", "open ai/model", "openai/mo del", "openai/\tmodel", "openai/model\n", "openai/\u00a0model"];
    for (const fallbackModel of invalidOptions) {
        await withPlugin({ fallbackModel }, ({ hooks, logs }) => Effect.sync(() => {
            assert.equal(hooks.has("retry"), false, `retry hook registered for ${JSON.stringify(fallbackModel)}`);
            const errors = logs.filter((entry) => entry.logLevel === "Error");
            assert.equal(errors.length, 1);
            const message = errors[0].message.join(" ");
            assert.match(message, /options\.fallbackModel/);
            assert.match(message, /provider\/model/);
            assert.match(message, /fallback handling disabled/i);
            assert.match(message, /set|provide|use/i);
            assert.equal(hooks.has("http.response"), true);
        }));
    }
});
