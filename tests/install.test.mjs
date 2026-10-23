import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const installer = join(repository, "install.sh");
const temporaryRoot = tmpdir();
const pluginName = "opencode-model-switch-on-failure";

function fixture(context) {
    const root = mkdtempSync(join(temporaryRoot, "installer-test-"));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const home = join(root, "home");
    mkdirSync(home);
    const run = (args = [], environment = {}, options = {}) => spawnSync("/bin/sh", [options.script ?? installer, ...args], {
        cwd: options.cwd ?? root,
        env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "", ...environment },
        encoding: "utf8",
        timeout: 5000,
    });
    return { root, home, run, config: join(home, ".config/opencode") };
}

function destination(config) {
    return join(config, "plugins", pluginName);
}

function utilityPath(root, overrides = {}) {
    const directory = join(root, "utilities");
    mkdirSync(directory);
    for (const name of ["dirname", "mkdir", "cmp", "cat", "mv", "rm", "chmod"]) {
        if (overrides[name]) {
            writeFileSync(join(directory, name), `#!/bin/sh\n${overrides[name]}\n`);
            chmodSync(join(directory, name), 0o755);
        } else {
            const path = ["/bin", "/usr/bin"].map((base) => join(base, name)).find(existsSync);
            assert.ok(path, `${name} is available as a POSIX utility`);
            symlinkSync(path, join(directory, name));
        }
    }
    return directory;
}

function assertOwnedSymlinkRefused({ root, run }, directory, name, contents, dangling) {
    rmSync(directory, { recursive: true });
    mkdirSync(directory);
    const outside = join(root, "outside-file");
    if (!dangling) writeFileSync(outside, contents);
    symlinkSync(outside, join(directory, name));
    const result = run();
    assert.notEqual(result.status, 0, `${name}, dangling: ${dangling}`);
    assert.match(result.stderr, /symbolic link.*move/i);
    assert.ok(result.stderr.includes(join(directory, name)));
    assert.deepEqual(readdirSync(directory), [name]);
    if (!dangling) {
        assert.deepEqual(readFileSync(outside), contents);
        rmSync(outside);
    } else assert.equal(existsSync(outside), false);
}

function createCollision(config, name) {
    const directory = destination(config);
    mkdirSync(join(config, "plugins"), { recursive: true });
    if (name === "plugins parent") {
        const path = join(config, "plugins");
        rmSync(path, { recursive: true });
        writeFileSync(path, "preserve");
        return path;
    }
    const path = name === "plugin directory" ? directory : join(directory, name);
    if (name === "plugin directory") writeFileSync(path, "preserve");
    else mkdirSync(path, { recursive: true });
    return path;
}

test("fixtures use the operating system temporary directory", (context) => {
    const { root } = fixture(context);
    assert.equal(dirname(root), resolve(tmpdir()));
});

test("help describes the global default without writing files", (context) => {
    const { root, run } = fixture(context);
    const result = run(["--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:.*\[--global \| --target <directory>\]/);
    assert.match(result.stdout, /global.*default/i);
    assert.deepEqual(readdirSync(root), ["home"]);
});

test("invalid arguments fail before writing files", (context) => {
    const { root, run } = fixture(context);
    for (const args of [["--unknown"], ["--global", "--global"], ["--target"], ["--target", ""], ["--target", "--global"], ["--target", "--name"], ["--global", "--target", "project"], ["--target", "a", "--target", "b"], ["--target", "a", "--global"], ["--target", "a", "--help"], ["--help", "--global"], ["--help", "--help"], ["--help", "--target", "a"], ["--global", "--help"], ["--global", "extra"], ["--target", "a", "extra"], ["extra"]]) {
        const result = run(args);
        assert.notEqual(result.status, 0, JSON.stringify(args));
        assert.match(result.stderr, /Usage:/);
        assert.deepEqual(readdirSync(root), ["home"]);
    }
});

test("default global installation copies only the source supplied to the host runtime", (context) => {
    const { config, run } = fixture(context);
    const result = run();
    const directory = destination(config);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(directory), "default global plugin directory must exist");
    assert.deepEqual(readdirSync(directory), ["index.ts"]);
    assert.deepEqual(readFileSync(join(directory, "index.ts")), readFileSync(join(repository, "model-switch-on-failure.ts")));
    assert.deepEqual(readdirSync(config), ["plugins"]);
});

test("global modes honour an absolute XDG_CONFIG_HOME", (context) => {
    const { root, home, run } = fixture(context);
    for (const [index, args] of [[], ["--global"]].entries()) {
        const xdg = join(root, `xdg ${index}`);
        const result = run(args, { XDG_CONFIG_HOME: xdg });
        assert.equal(result.status, 0, result.stderr);
        assert.ok(existsSync(destination(join(xdg, "opencode"))), "XDG plugin directory must exist");
    }
    assert.deepEqual(readdirSync(home), []);
});

test("global modes reject relative XDG_CONFIG_HOME before writing", (context) => {
    const { root, run } = fixture(context);
    const result = run([], { XDG_CONFIG_HOME: "relative-config" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /XDG_CONFIG_HOME.*absolute.*unset/i);
    assert.deepEqual(readdirSync(root), ["home"]);
});

test("target installation resolves caller paths independently of checkout and XDG", (context) => {
    const { root, home, run } = fixture(context);
    for (const target of ["project space's", join(root, "absolute project's")]) {
        const result = run(["--target", target], { XDG_CONFIG_HOME: "ignored-relative" });
        assert.equal(result.status, 0, result.stderr);
        const directory = destination(join(resolve(root, target), "config/opencode"));
        assert.ok(existsSync(join(directory, "index.ts")), "target entrypoint must exist");
    }
    assert.deepEqual(readdirSync(home), []);
});

test("identical reruns leave all existing files untouched", (context) => {
    const { config, run } = fixture(context);
    assert.equal(run().status, 0);
    const directory = destination(config);
    writeFileSync(join(directory, "keep.txt"), "unrelated");
    const before = readdirSync(directory).map((name) => [name, statSync(join(directory, name)), readFileSync(join(directory, name))]);
    const result = run(["--global"]);
    assert.equal(result.status, 0, result.stderr);
    for (const [name, metadata, contents] of before) {
        assert.deepEqual(readFileSync(join(directory, name)), contents);
        assert.equal(statSync(join(directory, name)).mtimeMs, metadata.mtimeMs);
        assert.equal(statSync(join(directory, name)).ino, metadata.ino);
    }
});

test("a differing source replaces only the managed entrypoint with fresh-install permissions", (context) => {
    const { root, config, run } = fixture(context);
    const { script, source } = isolatedInstaller(root);
    const initialSource = Buffer.from("initial checkout source\n");
    const updatedSource = Buffer.from("updated checkout source\nwith more bytes\n");
    writeFileSync(source, initialSource);
    const initial = run([], {}, { script });
    assert.equal(initial.status, 0, initial.stderr);

    const directory = destination(config);
    const path = join(directory, "index.ts");
    const freshMode = statSync(path).mode & 0o777;
    writeFileSync(join(directory, "keep.txt"), "unrelated data");
    writeFileSync(source, updatedSource);
    const result = run([], {}, { script });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(path), updatedSource);
    assert.equal(statSync(path).mode & 0o777, freshMode);
    assert.equal(readFileSync(join(directory, "keep.txt"), "utf8"), "unrelated data");
    assert.deepEqual(readdirSync(directory).sort(), ["index.ts", "keep.txt"]);
});

test("a failed update write preserves the installed entrypoint and removes its staging file", (context) => {
    const { root, config, run } = fixture(context);
    const { script, source } = isolatedInstaller(root);
    writeFileSync(source, "installed version\n");
    assert.equal(run([], {}, { script }).status, 0);
    const directory = destination(config);
    const path = join(directory, "index.ts");
    const original = readFileSync(path);
    writeFileSync(source, "replacement version\n");
    const PATH = utilityPath(root, {
        cat: 'case "$1" in *model-switch-on-failure.ts) printf partial; exit 74 ;; *) exec "$REAL_CAT" "$@" ;; esac',
    });

    const result = run([], { PATH, REAL_CAT: ["/bin/cat", "/usr/bin/cat"].find(existsSync) }, { script });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot write.*update|update.*cannot write/i);
    assert.ok(result.stderr.includes(path));
    assert.deepEqual(readFileSync(path), original);
    assert.deepEqual(readdirSync(directory), ["index.ts"]);
});

test("a failed update move preserves the installed entrypoint and removes its staging file", (context) => {
    const { root, config, run } = fixture(context);
    const { script, source } = isolatedInstaller(root);
    writeFileSync(source, "installed version\n");
    assert.equal(run([], {}, { script }).status, 0);
    const directory = destination(config);
    const path = join(directory, "index.ts");
    const original = readFileSync(path);
    writeFileSync(source, "replacement version\n");
    const PATH = utilityPath(root, { mv: "exit 73" });

    const result = run([], { PATH }, { script });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot replace.*update|update.*cannot replace/i);
    assert.ok(result.stderr.includes(path));
    assert.deepEqual(readFileSync(path), original);
    assert.deepEqual(readdirSync(directory), ["index.ts"]);
});

test("a failed staging permission change preserves the entrypoint and removes the private stage", (context) => {
    const { root, config, run } = fixture(context);
    const { script, source } = isolatedInstaller(root);
    writeFileSync(source, "installed version\n");
    assert.equal(run([], {}, { script }).status, 0);
    const directory = destination(config);
    const path = join(directory, "index.ts");
    const original = readFileSync(path);
    writeFileSync(source, "replacement version\n");
    const PATH = utilityPath(root, {
        chmod: '"$NODE_BIN" -e \'process.exit((require("node:fs").statSync(process.argv[1]).mode & 0o777) === 0o600 ? 0 : 74)\' "$2" || exit 74; exit 73',
    });

    const result = run([], { PATH, NODE_BIN: process.execPath }, { script });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot set.*permission|permission.*cannot set/i);
    assert.ok(result.stderr.includes(path));
    assert.deepEqual(readFileSync(path), original);
    assert.deepEqual(readdirSync(directory), ["index.ts"]);
});

test("failed staging cleanup reports the leftover path actionably", (context) => {
    const { root, config, run } = fixture(context);
    const { script, source } = isolatedInstaller(root);
    writeFileSync(source, "installed version\n");
    assert.equal(run([], {}, { script }).status, 0);
    const directory = destination(config);
    const original = readFileSync(join(directory, "index.ts"));
    writeFileSync(source, "replacement version\n");
    const PATH = utilityPath(root, {
        cat: 'case "$1" in *model-switch-on-failure.ts) printf partial; exit 74 ;; *) exec "$REAL_CAT" "$@" ;; esac',
        rm: "exit 73",
    });

    const result = run([], { PATH, REAL_CAT: ["/bin/cat", "/usr/bin/cat"].find(existsSync) }, { script });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /staging.*remove|remove.*staging/i);
    assert.deepEqual(readFileSync(join(directory, "index.ts")), original);
    const leftover = readdirSync(directory).find((name) => name !== "index.ts");
    assert.ok(leftover, "failed cleanup should leave a reported staging path");
    assert.ok(result.stderr.includes(join(directory, leftover)));
});

test("plugin directory symlinks are refused without touching their targets", (context) => {
    const { root, config, run } = fixture(context);
    const directory = destination(config);
    const outside = join(root, "outside");
    mkdirSync(outside);
    mkdirSync(join(config, "plugins"), { recursive: true });
    symlinkSync(outside, directory);
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symbolic link.*move/i);
    assert.ok(result.stderr.includes(directory));
    assert.deepEqual(readdirSync(outside), []);
});

test("owned file symlinks are refused even for identical or missing targets", (context) => {
    const setup = fixture(context);
    const { config, run } = setup;
    assert.equal(run().status, 0);
    const directory = destination(config);
    const originals = Object.fromEntries(readdirSync(directory).map((name) => [name, readFileSync(join(directory, name))]));
    for (const [name, contents] of Object.entries(originals)) {
        for (const dangling of [false, true]) {
            assertOwnedSymlinkRefused(setup, directory, name, contents, dangling);
        }
    }
});

test("filesystem collisions report actionable paths without adding owned files", (context) => {
    const { config, run } = fixture(context);
    const directory = destination(config);
    for (const name of ["index.ts", "plugin directory", "plugins parent"]) {
        const path = createCollision(config, name);
        const result = run();
        assert.notEqual(result.status, 0, name);
        assert.ok(result.stderr.includes(path), result.stderr);
        assert.match(result.stderr, /move.*rerun|check.*rerun/i);
        assert.doesNotMatch(result.stdout, /prepared/i);
        if (name.endsWith(".json") || name.endsWith(".ts")) assert.deepEqual(readdirSync(directory), [name]);
        else assert.equal(readFileSync(path, "utf8"), "preserve");
        rmSync(join(config, "plugins"), { recursive: true });
    }
});

test("global output explains auto-discovery and options using a directory registration example", (context) => {
    const { config, run } = fixture(context);
    mkdirSync(config, { recursive: true });
    const existing = '{"plugins":[{"package":"keep-me"}]}\n';
    writeFileSync(join(config, "opencode.json"), existing);
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /installation complete.*installed source/i);
    assert.ok(result.stdout.includes(destination(config)));
    assert.doesNotMatch(result.stdout, /npm|node_modules|install --omit/);
    assert.ok(result.stdout.includes(join(config, "opencode.json")));
    const example = JSON.parse(result.stdout.match(/\{\n[\s\S]*\n\}/)?.[0] ?? "{}");
    assert.deepEqual(example, {
        $schema: "https://opencode.ai/config.json",
        plugins: [{ package: `./plugins/${pluginName}`, options: { fallbackModel: "openai/gpt-6-luna" } }],
    });
    assert.match(result.stdout, /append.*merge.*not replace/i);
    assert.match(result.stdout, /plugin directory is auto-discovered.*default options/i);
    assert.match(result.stdout, /configuration entry.*configure.*options/i);
    assert.doesNotMatch(result.stdout, /register the installed source file explicitly|\.ts["']/i);
    assert.match(result.stdout, /optional.*default.*openai\/gpt-6-luna/i);
    assert.equal(readFileSync(join(config, "opencode.json"), "utf8"), existing);
    assert.equal(existsSync(join(config, "opencode.jsonc")), false);
});

test("arbitrary global paths are printed literally without dependency commands", (context) => {
    const { root, run } = fixture(context);
    const xdg = join(root, "config space's $literal; text");
    const result = run([], { XDG_CONFIG_HOME: xdg });
    assert.equal(result.status, 0, result.stderr);
    const directory = destination(join(xdg, "opencode"));
    assert.ok(result.stdout.includes(join(directory, "index.ts")));
    assert.doesNotMatch(result.stdout, /npm|node_modules/);
});

test("configuration guidance prefers existing JSONC only when JSON is absent", (context) => {
    const { config, run } = fixture(context);
    mkdirSync(config, { recursive: true });
    const jsonc = "// retain comments\n{\"plugins\": []}\n";
    const json = '{"plugins":[{"package":"existing"}]}';
    writeFileSync(join(config, "opencode.jsonc"), jsonc);
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.ok(first.stdout.includes(`Configuration example for ${join(config, "opencode.jsonc")}:`));
    assert.equal(existsSync(join(config, "opencode.json")), false);
    assert.equal(readFileSync(join(config, "opencode.jsonc"), "utf8"), jsonc);
    writeFileSync(join(config, "opencode.json"), json);
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.ok(second.stdout.includes(`Configuration example for ${join(config, "opencode.json")}:`));
    assert.equal(readFileSync(join(config, "opencode.jsonc"), "utf8"), jsonc);
    assert.equal(readFileSync(join(config, "opencode.json"), "utf8"), json);
});

test("target guidance offers a discoverable root configuration alternative", (context) => {
    const { root, run } = fixture(context);
    const target = join(root, "target project's");
    mkdirSync(target);
    const existing = "// project options\n{\"plugins\": [{\"package\": \"keep\"}]}\n";
    writeFileSync(join(target, "opencode.jsonc"), existing);
    const result = run(["--target", target]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /custom.*not auto-discovered/i);
    const config = join(target, "config/opencode");
    assert.ok(result.stdout.includes(`Configuration example for ${join(config, "opencode.json")}:`));
    assert.ok(result.stdout.includes(`Configuration example for ${join(target, "opencode.jsonc")}:`));
    const examples = [...result.stdout.matchAll(/^\{\n[\s\S]*?^\}/gm)].map(([value]) => JSON.parse(value));
    assert.deepEqual(examples.map((example) => example.plugins[0].package), [
        `./plugins/${pluginName}`, `./config/opencode/plugins/${pluginName}`,
    ]);
    for (const example of examples) {
        assert.equal(example.$schema, "https://opencode.ai/config.json");
        assert.deepEqual(example.plugins[0].options, { fallbackModel: "openai/gpt-6-luna" });
    }
    assert.match(result.stdout, /relative.*configuration.*contain/i);
    assert.doesNotMatch(result.stdout, /OPENCODE_CONFIG/);
    assert.equal(readFileSync(join(target, "opencode.jsonc"), "utf8"), existing);
    assert.equal(existsSync(join(target, "opencode.json")), false);
    assert.deepEqual(readdirSync(config), ["plugins"]);
    assert.doesNotMatch(result.stdout, /npm|node_modules/);
});

test("legacy manifests and installed dependencies remain untouched", (context) => {
    const { config, run } = fixture(context);
    const directory = destination(config);
    mkdirSync(join(directory, "node_modules"), { recursive: true });
    const manifest = "a legacy manifest, not even JSON\n";
    writeFileSync(join(directory, "package.json"), manifest);
    writeFileSync(join(directory, "node_modules/keep"), "keep dependency");
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(directory, "package.json"), "utf8"), manifest);
    assert.equal(readFileSync(join(directory, "node_modules/keep"), "utf8"), "keep dependency");
    assert.deepEqual(readdirSync(directory).sort(), ["index.ts", "node_modules", "package.json"]);
});

test("fallback global installation rejects missing, empty or relative HOME before mkdir", (context) => {
    const { root, run } = fixture(context);
    const PATH = utilityPath(root, { mkdir: "printf 'mkdir must not run\\n' >&2; exit 98" });
    for (const HOME of [undefined, "", "relative-home"]) {
        const result = run([], { HOME, PATH });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /HOME.*non-empty.*absolute.*--target/i);
        assert.doesNotMatch(result.stderr, /mkdir must not run/);
        assert.deepEqual(readdirSync(root).sort(), ["home", "utilities"]);
    }
});

test("comparison errors are distinguished from content conflicts", (context) => {
    const { root, config, run } = fixture(context);
    assert.equal(run().status, 0);
    const path = join(destination(config), "index.ts");
    const before = readFileSync(path);
    const PATH = utilityPath(root, { cmp: "exit 2" });
    const result = run([], { PATH });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot inspect.*check.*permissions.*rerun/i);
    assert.ok(result.stderr.includes(path));
    assert.doesNotMatch(result.stderr, /conflict/i);
    assert.doesNotMatch(result.stdout, /prepared|installed source/i);
    assert.deepEqual(readFileSync(path), before);
});

function isolatedInstaller(root) {
    const checkout = join(root, "checkout space's $literal; []");
    mkdirSync(checkout);
    const script = join(checkout, "install.sh");
    writeFileSync(script, readFileSync(installer));
    return { script, source: join(checkout, "model-switch-on-failure.ts") };
}

test("help requires neither environment nor source files nor external utilities", (context) => {
    const { root, run } = fixture(context);
    const { script } = isolatedInstaller(root);
    for (const environment of [
        { HOME: undefined, XDG_CONFIG_HOME: undefined },
        { HOME: "", XDG_CONFIG_HOME: "" },
        { HOME: "invalid", XDG_CONFIG_HOME: "invalid" },
    ]) {
        const result = run(["--help"], { ...environment, PATH: "/nonexistent" }, { script });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Usage: sh \.\/install.sh/);
        assert.deepEqual(readdirSync(dirname(script)), ["install.sh"]);
        assert.deepEqual(readdirSync(root).sort(), ["checkout space's $literal; []", "home"]);
    }
});

test("invalid arguments take precedence over environment and source inspection", (context) => {
    const { root, run } = fixture(context);
    const { script } = isolatedInstaller(root);
    const result = run(["--help", "--target", "a"], { HOME: "", XDG_CONFIG_HOME: "invalid", PATH: "/nonexistent" }, { script });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage:/);
    assert.doesNotMatch(result.stderr, /not found|HOME|source/);
    assert.deepEqual(readdirSync(dirname(script)), ["install.sh"]);
});

test("valid XDG global installation does not depend on HOME", (context) => {
    const { root, run } = fixture(context);
    for (const [index, HOME] of [undefined, "", "relative-home"].entries()) {
        const XDG_CONFIG_HOME = join(root, `xdg-${index}`);
        const result = run(["--global"], { HOME, XDG_CONFIG_HOME });
        assert.equal(result.status, 0, result.stderr);
        assert.ok(existsSync(join(destination(join(XDG_CONFIG_HOME, "opencode")), "index.ts")));
    }
});

test("target paths ignore missing or invalid global environment", (context) => {
    const { root, run } = fixture(context);
    for (const [index, environment] of [
        { HOME: undefined, XDG_CONFIG_HOME: undefined },
        { HOME: "", XDG_CONFIG_HOME: "" },
        { HOME: "relative-home", XDG_CONFIG_HOME: "relative-xdg" },
    ].entries()) {
        const target = `nested missing ${index}/project space's $literal; [*]`;
        const result = run(["--target", target], environment);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(readFileSync(join(destination(join(root, target, "config/opencode")), "index.ts")), readFileSync(join(repository, "model-switch-on-failure.ts")));
    }
});

test("hyphen-leading target operands are accepted with unambiguous spelling", (context) => {
    const { root, run } = fixture(context);
    for (const target of ["-project", "./--name"]) {
        const result = run(["--target", target]);
        assert.equal(result.status, 0, result.stderr);
        assert.ok(existsSync(join(destination(join(root, target, "config/opencode")), "index.ts")));
    }
});

test("installation uses only the allowlisted POSIX utilities without a language runtime", (context) => {
    const { root, config, run } = fixture(context);
    const PATH = utilityPath(root);
    assert.deepEqual(readdirSync(PATH).sort(), ["cat", "chmod", "cmp", "dirname", "mkdir", "mv", "rm"]);
    for (let attempt = 0; attempt < 2; attempt++) {
        const result = run([], { PATH });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(readFileSync(join(destination(config), "index.ts")), readFileSync(join(repository, "model-switch-on-failure.ts")));
    }
});

test("source resolution is independent of CDPATH and a symlinked caller directory", (context) => {
    const { root, run } = fixture(context);
    const { script, source } = isolatedInstaller(root);
    writeFileSync(source, "a self-contained fixture source\n");
    const physical = join(root, "physical");
    mkdirSync(physical);
    const alias = join(root, "alias");
    symlinkSync(physical, alias);
    const result = run(["--target", "new/nested"], { CDPATH: root, PWD: alias }, { script, cwd: alias });
    assert.equal(result.status, 0, result.stderr);
    const path = join(destination(join(physical, "new/nested/config/opencode")), "index.ts");
    assert.equal(readFileSync(path, "utf8"), "a self-contained fixture source\n");
    assert.ok(result.stdout.includes(path));
});

test("missing or nonregular sources fail before creating destination directories", (context) => {
    const { root, config, run } = fixture(context);
    const { script, source } = isolatedInstaller(root);
    for (const kind of ["missing", "directory", "fifo"]) {
        if (kind === "directory") mkdirSync(source);
        if (kind === "fifo") assert.equal(spawnSync("/usr/bin/mkfifo", [source]).status, 0);
        const result = run([], {}, { script });
        assert.notEqual(result.status, 0, result.error?.message);
        assert.equal(result.error, undefined);
        assert.match(result.stderr, /cannot read regular source.*restore.*permissions/i);
        assert.ok(result.stderr.includes(source));
        assert.doesNotMatch(result.stdout, /prepared|installed source/i);
        assert.equal(existsSync(config), false);
        if (kind !== "missing") rmSync(source, { recursive: true });
    }
});

test("dangling plugin directory symlinks are refused before creating their targets", (context) => {
    const { root, config, run } = fixture(context);
    mkdirSync(join(config, "plugins"), { recursive: true });
    const outside = join(root, "missing-outside");
    symlinkSync(outside, destination(config));
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symbolic link.*move/i);
    assert.ok(result.stderr.includes(destination(config)));
    assert.equal(existsSync(outside), false);
});

test("FIFO destinations are refused without blocking", (context) => {
    const { config, run } = fixture(context);
    mkdirSync(destination(config), { recursive: true });
    const path = join(destination(config), "index.ts");
    assert.equal(spawnSync("/usr/bin/mkfifo", [path]).status, 0);
    const result = run();
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /regular file.*move.*rerun/i);
    assert.ok(result.stderr.includes(path));
    assert.equal(statSync(path).isFIFO(), true);
    assert.doesNotMatch(result.stdout, /prepared|installed source/i);
});

test("ordinary configuration parent symlinks are allowed", (context) => {
    const { root, home, config, run } = fixture(context);
    const outside = join(root, "config-storage");
    mkdirSync(outside);
    symlinkSync(outside, join(home, ".config"));
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(join(destination(config), "index.ts")), readFileSync(join(repository, "model-switch-on-failure.ts")));
});

test("failed initial source reads report partial output and a rerun repairs it", (context) => {
    const { root, config, run } = fixture(context);
    const PATH = utilityPath(root, { cat: "printf 'partial source'; exit 74" });
    const result = run([], { PATH });
    const path = join(destination(config), "index.ts");
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(path));
    assert.match(result.stderr, /cannot copy.*partial file.*inspect.*move.*rerun/i);
    assert.doesNotMatch(result.stdout, /prepared|installed source|configuration example/i);
    assert.equal(readFileSync(path, "utf8"), "partial source");
    const rerun = run();
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.deepEqual(readFileSync(path), readFileSync(join(repository, "model-switch-on-failure.ts")));
});

test("a destination appearing after preflight is never overwritten", (context) => {
    const { root, config, run } = fixture(context);
    const PATH = utilityPath(root, { mkdir: '"$REAL_MKDIR" "$@" || exit; printf preserve > "$2/index.ts"' });
    const result = run([], { PATH, REAL_MKDIR: existsSync("/bin/mkdir") ? "/bin/mkdir" : "/usr/bin/mkdir" });
    const path = join(destination(config), "index.ts");
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(path));
    assert.match(result.stderr, /cannot copy.*inspect.*move.*rerun/i);
    assert.doesNotMatch(result.stdout, /prepared|installed source/i);
    assert.equal(readFileSync(path, "utf8"), "preserve");
});

test("directory creation failures report the destination path without success", (context) => {
    const { root, config, run } = fixture(context);
    const PATH = utilityPath(root, { mkdir: "exit 73" });
    const result = run([], { PATH });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot create.*check.*permissions.*rerun/i);
    assert.ok(result.stderr.includes(destination(config)));
    assert.equal(existsSync(config), false);
    assert.doesNotMatch(result.stdout, /prepared|installed source/i);
});

test("the shell entrypoint has its executable bit set", () => {
    assert.notEqual(statSync(installer).mode & 0o111, 0);
});

test("installation is exposed only through the shell entrypoint rather than npm", () => {
    const manifest = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
    assert.equal(Object.hasOwn(manifest.scripts, "install-plugin"), false);
    assert.equal(existsSync(join(repository, "scripts/install.mjs")), false);
    const documentation = readFileSync(join(repository, "README.md"), "utf8");
    assert.match(documentation, /sh \.\/install.sh --global/);
    assert.match(documentation, /sh \.\/install.sh --target/);
    assert.match(documentation, /sh \.\/install.sh --help/);
    assert.doesNotMatch(documentation, /scripts\/install.mjs|npm run install-plugin|npm --prefix/);
});

test("README documents safe updates without weakening unrelated-file protections", () => {
    const documentation = readFileSync(join(repository, "README.md"), "utf8");
    assert.match(documentation, /identical source.*untouched/i);
    assert.match(documentation, /differing (?:checkout )?source.*updates?.*index\.ts/i);
    assert.match(documentation, /symlink.*nonregular.*refus/i);
    assert.match(documentation, /all other files.*left untouched/i);
    assert.match(documentation, /appears after preflight.*not overwritten/i);
    assert.match(documentation, /partial.*rerun.*repairs?/i);
    assert.doesNotMatch(documentation, /partial.*inspect or move.*before rerunning/i);
    assert.match(documentation, /update write, permission-setting, or move failures preserve the previous.*remove the staging file when possible/i);
    assert.match(documentation, /cleanup fails.*reports its path/i);
    assert.doesNotMatch(documentation, /differing source.*refused|no existing source is overwritten/i);
});
