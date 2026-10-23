# Opencode Model Switching on Failure plugin
This plugin tries to fix an issue where models return a 429 and fail within a subagent when they hit a rate limit. The plugin detects a 429 and sets a longer wait between retries (to handle rate limits refreshing) then downgrades to a fallback model after a set number of tries.

## Install:

### Run the script:
Run the install script to install the plugin to the default global OpenCode plugin location: `~/.config/opencode/plugins`. The default is global; `--global` selects the same location explicitly.

```sh
sh ./install.sh
sh ./install.sh --global
sh ./install.sh --target /path/to/project
sh ./install.sh --help
```

To copy the source under a particular base directory instead, use `--target` (paths with spaces are supported):

```sh
sh ./install.sh --target "./project with spaces"
```

### Register in opencode.json:

As the install script states the plugin also needs to be registered in ~/.config/opencode/opencode.json:

'fallbackModel' is optional, but the hardcoded fallback is `openai/gpt-6-luna`, which may eventually become unavailable. The `maxRetries` option defaults to `100` and controls the retry threshold at which the plugin exits a subagent back to primary session on HTTP 429 responses. The `retriesBeforeFallback` defaults to `101` and is how many retries before it will switch model.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./plugins/opencode-model-switch-on-failure",
      "options": {
        "fallbackModel": "openai/gpt-6-luna",
        "maxRetries": 10,
        "retriesBeforeFallabck": 5
      }
    }
  ]
}
```

The installer owns exactly one file under `<config>/plugins/opencode-model-switch-on-failure/`: `index.ts`, copied byte-for-byte from the checkout's `model-switch-on-failure.ts` source.

### Safe updates:

An identical source leaves the managed file untouched. A differing checkout source updates only `index.ts`; all other files are left untouched. Managed symlinks and nonregular entries are refused. If a destination appears after preflight, it is not overwritten. After a partial initial write, rerunning the installer repairs it. Update write, permission-setting, or move failures preserve the previous `index.ts` and remove the staging file when possible; if cleanup fails, the installer reports its path.

### Target configuration:

`<target>/config/opencode/opencode.json` (or `.jsonc`) is a custom location and is not auto-discovered by OpenCode. The installer prints the same plugin options example (`fallbackModel` and `retries`) for that location, but preparing those files alone does not make OpenCode load them.

For a discoverable project-root alternative, append or merge this object entry into `<target>/opencode.json`, or the existing `<target>/opencode.jsonc` when JSON is absent:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./config/opencode/plugins/opencode-model-switch-on-failure",
      "options": {
        "fallbackModel": "openai/gpt-6-luna",
        "maxRetries": 10,
        "retriesBeforeFallabck": 5
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
