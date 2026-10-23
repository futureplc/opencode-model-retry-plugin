import { Model, Plugin, Provider } from "@opencode/plugin/effect";
import { Effect } from "effect";
import type { SessionHttpResponse, SessionRetry } from "@opencode/plugin/effect/session";
import type { Scope } from "effect";

function parseFallbackModel(configuredFallback: unknown): Model.Ref | undefined {
    const fallbackName: unknown = configuredFallback === undefined ? "openai/gpt-6-luna" : configuredFallback;
    if (typeof fallbackName !== "string" || !/^[^\s/]+\/\S+$/.test(fallbackName)) {
        return undefined;
    }
    const separatorIndex: number = fallbackName.indexOf("/");
    return {
        providerID: Provider.ID.make(fallbackName.slice(0, separatorIndex)),
        id: Model.ID.make(fallbackName.slice(separatorIndex + 1)),
    };
}

function pauseRetries(
    ctx: Plugin.Context,
    event: SessionRetry
): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        event.decision = { retry: false };

        const session = yield* ctx.session.get({ sessionID: event.sessionID });
        if (!session.parentID) {
            return Effect.void
        }

        const modelName =
            `${event.model.providerID}/${event.model.id}` +
            (event.model.variant ? `#${event.model.variant}` : "");

        return yield* ctx.session.prompt({
            sessionID: session.parentID,
            text: `Subagent session id ${event.sessionID} hit a 429 error using model ${modelName} inform the user `
                + ` with a summary of what the subagent was doing and present options  for continuing the work `
                + ` as a interactable menu.`,
        });
    });
}

function switchToFallbackModel(
    ctx: Plugin.Context,
    event: SessionRetry,
    fallbackModel: Model.Ref
): Effect.Effect<void, unknown> {
    event.decision = { retry: false };

    return Effect.gen(function* () {
        yield* ctx.session.switchModel({
            sessionID: event.sessionID,
            model: fallbackModel,
        });
        yield* ctx.session.prompt({
            sessionID: event.sessionID,
            text: "Resume the most recent unanswered request using the current conversation context and available tools. Avoid repeating completed work.",
            delivery: "queue",
        });
    });
}

function setRetryTime(event: SessionRetry): Effect.Effect<void, unknown> {
    const delay: number = Math.min(event.attempt * 10_000, 60_000);

    if (event.decision.retry) {
        event.decision = { retry: true, delay: delay };
    }
    return Effect.void;
}

export default Plugin.define({
    id: "handle-model-429-errors",
    effect: (ctx: Plugin.Context): Effect.Effect<void, never, Scope.Scope> =>
    Effect.gen(function* (): Generator<Effect.Effect<unknown, never, Scope.Scope>, void, unknown> {
        yield* Effect.logInfo("[model-fallback-test] plugin loaded", {
            version: ctx.app.version,
        });

        yield* ctx.session.hook("http.response", (event: SessionHttpResponse): Effect.Effect<void> =>
            event.response.status === 429
                ? Effect.logInfo("[model-fallback-test] Caught 429 response!", {
                    status: event.response.status,
                })
                : Effect.void,
        );

        yield* ctx.session.hook("retry", (event: SessionRetry): Effect.Effect<void> =>
            Effect.gen(function* (): Generator<Effect.Effect<unknown, unknown>, void, unknown> {
                if (event.error.status !== 429) return;

                const fallbackModel: Model.Ref | undefined = parseFallbackModel(ctx.options.fallbackModel);
                if (fallbackModel === undefined) {
                    yield* Effect.logError("[model-fallback-test] Invalid options.fallbackModel: set a non-empty provider/model string without whitespace; fallback handling disabled.");
                    return;
                }

                const retriesBeforeFallback: number = typeof ctx.options.retriesBeforeFallback === "number" ? ctx.options.retriesBeforeFallback : 101;
                if (event.attempt >= retriesBeforeFallback +1) {
                    yield* switchToFallbackModel(ctx, event, fallbackModel);
                }

                const maxRetries: number = typeof ctx.options.maxRetries === "number" ? ctx.options.maxRetries : 100;
                if (event.attempt >= maxRetries +1) {
                    yield* pauseRetries(ctx, event);
                    return;
                }

                yield* setRetryTime(event);
            }).pipe(
                Effect.catch((error: unknown): Effect.Effect<void> =>
                    Effect.logError("[model-fallback-test] Failed to switch to fallback model", {
                        error: String(error),
                    }),
                ),
            ),
        );
    }),
});
