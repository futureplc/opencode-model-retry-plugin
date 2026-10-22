# Opencode Model Switching on Failure plugin
This plugin tries to fix an issue where models return a 429 and fail within a subagent when they hit a rate limit. The plugin detects a 429 and sets a longer wait between retries (to handle rate limits refreshing) then downgrades to a fallback model after a set number of tries.

### Install:

Requires a POSIX shell and standard macOS/Linux utilities. The OpenCode V2 runtime supplies `@opencode/plugin` and `effect`; end-user installation needs no Node.js, npm, dependency installation or network access.

From this checkout, copy the global plugin source (the default when no flags are supplied):

```sh
sh ./install.sh
sh ./install.sh --global
```

These are equivalent commands. Global configuration uses `$XDG_CONFIG_HOME/opencode` when `XDG_CONFIG_HOME` is non-empty and absolute. If it is empty or unset, the installer requires a non-empty, absolute `HOME` and uses `$HOME/.config/opencode`. A relative `XDG_CONFIG_HOME` is rejected; set an absolute path or unset it. There is no account-home lookup.

To copy the source under a particular base directory instead:

```sh
sh ./install.sh --target /path/to/project
sh ./install.sh --target "./project with spaces"
sh ./install.sh --help
```

Target mode uses `<target>/config/opencode`, ignores both `HOME` and `XDG_CONFIG_HOME`, and resolves relative targets from your physical current directory. Missing target directories are created. The script finds its source beside itself, so it can also be invoked by absolute path from outside this checkout. A target beginning with `--` must be prefixed with `./`, for example `--target ./--name`; ordinary `-project` targets are accepted.

The installer owns exactly one file under `<config>/plugins/opencode-model-switch-on-failure/`: `index.ts`, copied byte-for-byte from the checkout's `model-switch-on-failure.ts` source.

It does not create a manifest or copy tests, development dependencies, repository scripts or `node_modules`. Legacy `package.json`, `node_modules` and all other files are ignored and left untouched, even if changed; there is no migration cleanup. It never creates, edits or parses OpenCode JSON or JSONC configuration. Only the existing configuration filename is inspected to choose the printed example.

For a global installation, the plugin directory is auto-discovered and loads with default options; a configuration entry is only needed to configure or override options. Target mode prints configuration examples, but its custom configuration location is not auto-discovered. There is no dependency command to run.

An identical source is left untouched on repeat runs, preserving its modification time and inode. A differing source, source-file or plugin-directory symlink (including dangling links), and nonregular-file or directory collisions are refused without overwriting. Ordinary configuration-parent symlinks are allowed. Move conflicting entries aside yourself before rerunning. Preparation is best-effort, not transactional: a read/write failure can leave a partial new source file. Inspect or move that path aside before rerunning; the installer does not blindly delete partial files. No existing source is overwritten. This is not a defence against adversarial races in parent directories.

### Global configuration and options:

The installer prints an example for `<config>/opencode.json`, or the existing `opencode.jsonc` if JSON is absent. Append or merge the object entry into your existing `plugins` array; do not replace your other entries or configuration.

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

OpenCode V2 uses plural `plugins`. Relative package entries resolve from the configuration file containing the entry. OpenCode auto-discovers global plugin directories, and the installed `index.ts` entrypoint is loaded with default options without a configuration entry. Use the optional entry above to configure or override options. See the [OpenCode V2 plugin documentation](https://opencode.ai/v2/docs/plugins).

`options.fallbackModel` must be a `provider/model` string with a non-empty provider and model and no whitespace anywhere. The first slash separates the provider from the model, so namespaced model IDs such as `organisation/model` are supported. Omit the option to retain the default `openai/gpt-6-luna`.

An invalid value, including `null`, logs one actionable configuration error and disables this plugin's fallback retry handling without failing plugin initialisation. OpenCode's native retries remain untouched, and the HTTP 429 logging hook stays active. Reload the plugin after editing its configuration or source.

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
