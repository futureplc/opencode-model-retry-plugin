# Opencode Model Switching on Failure plugin
This plugin tries to fix an issue where models return a 429 and fail within a subagent when they hit a rate limit. The plugin detects a 429 and sets a longer wait between retries (to handle rate limits refreshing) then downgrades to a fallback model after a set number of tries.

## Install:

### Run the script:
Run the install script to install the plugin to the default global opencode plugin location: ~/.config/opencode/plugins

```sh
sh ./install.sh
```

Or to copy the source under a particular base directory instead:

```sh
sh ./install.sh --target /path/to/project
sh ./install.sh --target "./project with spaces"
sh ./install.sh --help
```

### Register in opencode.json:

As the install script states the plugin also needs to be registered in ~/.config/opencode/opencode.json:

'fallbackModel' is optional, but the hardcoded fallback is openai/gpt-6-luna which will eventually become unavailable.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./plugins/opencode-model-switch-on-failure",
      "options": {
        "fallbackModel": "openai/gpt-6-luna"
      }
    }
  ]
}
```

The installer owns exactly one file under `<config>/plugins/opencode-model-switch-on-failure/`: `index.ts`, copied byte-for-byte from the checkout's `model-switch-on-failure.ts` source.

### Target configuration:

`<target>/config/opencode/opencode.json` (or `.jsonc`) is a custom location and is not auto-discovered by OpenCode. The installer prints the same configuration example for that location, but preparing those files alone does not make OpenCode load them.

For a discoverable project-root alternative, append or merge this object entry into `<target>/opencode.json`, or the existing `<target>/opencode.jsonc` when JSON is absent:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./config/opencode/plugins/opencode-model-switch-on-failure",
      "options": {
        "fallbackModel": "openai/gpt-6-luna"
      }
    }
  ]
}
```

The installed entrypoint is `<target>/config/opencode/plugins/opencode-model-switch-on-failure/index.ts`; this does not create a `.opencode` layout. Configuration merging remains manual. The project-root alternative works because its configuration is discoverable and its package path resolves from that root configuration file.

### Automated tests:

For repository development only, install the development dependencies with npm. With Node.js 24+ (tested on 24.18.0), run:

```sh
npm install
sh -n install.sh
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
