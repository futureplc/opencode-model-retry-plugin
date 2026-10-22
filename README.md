# Opencode Model Switching on Failure plugin
This plugin tries to fix an issue where models return a 429 and fail within a subagent when they hit a rate limit. The plugin detects a 429 and sets a longer wait between retries (to handle rate limits refreshing) then downgrades to a fallback model after a set number of tries.

### Registering in global opencode.json:

```json
{
  "plugins": [
    {
      "package": "/absolute/path/to/template.ts",
      "options": {
        "fallbackModel": "openai/gpt-6-luna"
      }
    }
  ]
}
```

Replace the absolute path with this repository's `template.ts` path. Preserve your other plugin entries and append this entry rather than replacing the `plugins` array. OpenCode loads the configuration and supplies the plugin options.

`options.fallbackModel` must be a `provider/model` string with a non-empty provider and model and no whitespace anywhere. The first slash separates the provider from the model, so namespaced model IDs such as `organisation/model` are supported. Omit the option to retain the default `openai/gpt-6-luna`.

An invalid value, including `null`, logs one actionable configuration error and disables this plugin's fallback retry handling without failing plugin initialisation. OpenCode's native retries remain untouched, and the HTTP 429 logging hook stays active. Reload the plugin after editing its configuration or source.

### Automated tests:

With Node.js 24+ (tested on 24.18.0), run:

```sh
npm test
npm run typecheck
```

### Manual Testing:

- Start opencode logs
  ```tail -f ~/.local/share/opencode/log/opencode.log ```

- Run mock provider that returns 429
  ```cd ~/.config/opencode/test ```
  ```node mock-provider.ts```

- Switch model to mock-gpt-4o and run a command
- Ask Opencode to run 'mock-429-log-test' skill to run a sub agent using the mock-gpt-4o model
