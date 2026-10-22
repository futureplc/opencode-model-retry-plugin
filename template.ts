import { Model, Plugin, Provider } from "@opencode/plugin/effect";
import { Effect } from "effect";

export default Plugin.define({
    id: "model-fallback-with-test",
    effect: (ctx) =>
        Effect.gen(function* () {
            yield* Effect.logInfo("[model-fallback-test] plugin loaded", {
                version: ctx.app.version,
            });

            yield* ctx.session.hook("http.response", (event) =>
                event.response.status === 429
                    ? Effect.logInfo("[model-fallback-test] Caught 429 response!", {
                        status: event.response.status,
                    })
                    : Effect.void,
            );

            const FALLBACK_MODEL = {
                providerID: Provider.ID.make("openai"),
                id: Model.ID.make("gpt-6-luna"),
            };

            yield* ctx.session.hook("retry", (event) =>
                Effect.gen(function* () {
                    if (event.error.status !== 429) return;

                    const isFallback: boolean =
                        event.model.providerID === FALLBACK_MODEL.providerID &&
                        event.model.id === FALLBACK_MODEL.id;

                    // Keep 429 retries delayed; don't switch away from the fallback again.
                    if (event.attempt < 2 || isFallback) {
                        if (event.decision.retry) {
                            event.decision = { retry: true, delay: 60_000 };
                        }
                        return;
                    }

                    // After one retry on the primary model, replace its next retry with a
                    // queued turn on the fallback model.
                    event.decision = { retry: false };
                    yield* ctx.session.switchModel({
                        sessionID: event.sessionID,
                        model: FALLBACK_MODEL,
                    });
                    yield* ctx.session.prompt({
                        sessionID: event.sessionID,
                        text: "Resume the most recent unanswered request using the current conversation context and available tools. Avoid repeating completed work.",
                        delivery: "queue",
                    });
                }).pipe(
                    Effect.catch((error) =>
                        Effect.logError("[model-fallback-test] Failed to switch to fallback model", {
                            error: String(error),
                        }),
                    ),
                ),
        );

//      yield* ctx.session.hook("retry", (event) =>
//        Effect.sync(() => {
//        // Delay retries OpenCode already decided to make; don't force new retries.
//          if (event.error.status === 429 && event.decision.retry) {
//            event.decision = { retry: true, delay: 60_000 };
//          }
//        }),
//      );
    }),
});
