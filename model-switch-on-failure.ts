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

function retryThenFallback(
    ctx: Plugin.Context,
    event: SessionRetry,
    fallbackModel: Model.Ref
): Effect.Effect<void, unknown> {
    const isFallback: boolean =
        event.model.providerID === fallbackModel.providerID &&
        event.model.id === fallbackModel.id;

    const retries: number = typeof ctx.options.retries === "number" ? ctx.options.retries : 5;

    if (event.attempt <= retries +1 || isFallback) {
        const delay: number = Math.min(event.attempt * 10_000, 60_000);

        if (event.decision.retry) {
            event.decision = { retry: true, delay: delay };
        }
        return Effect.void;
    }

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

export default Plugin.define({
    id: "model-fallback-with-test",
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

                    yield* retryThenFallback(ctx, event, fallbackModel);
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
